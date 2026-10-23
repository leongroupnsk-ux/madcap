import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatRub, maskAccount } from '@aesculap/shared';
import type { Prisma, User } from '@prisma/client';
import { AlertService } from '../common/alert.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';

/** Отправление закрыто: деньги поставщику уже не вернутся покупателю без отдельного возврата */
const CLOSED = ['delivered', 'cancelled', 'rejected'] as const;

/**
 * Аварийный режим выплат (ТЗ §8): когда сплит ЮKassa недоступен, оплату принимает платформа,
 * а поставщикам перечисляет сама — реестром платёжных поручений. Строки продаж попадают в реестр
 * после закрытия отправления, возвраты — сразу и уменьшают сумму поставщика. Если у поставщика
 * итог ≤ 0 или нет реквизитов, его строки ждут следующего реестра.
 */
@Injectable()
export class PayoutRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly alerts: AlertService,
  ) {}

  private readonly due: Prisma.PayoutWhereInput = {
    manual: true,
    registryId: null,
    OR: [{ kind: 'refund' }, { shipment: { status: { in: [...CLOSED] } } }],
  };

  /** Строки к выплате, сгруппированные по поставщику */
  async pending() {
    const rows = await this.prisma.payout.findMany({ where: this.due, include: { supplier: true }, orderBy: { createdAt: 'asc' } });
    const waiting = await this.prisma.payout.aggregate({ where: { manual: true, registryId: null, kind: 'sale', shipment: { status: { notIn: [...CLOSED] } } }, _sum: { transferred: true }, _count: true });
    const by = new Map<string, { supplier: (typeof rows)[number]['supplier']; ids: string[]; amount: number }>();
    for (const r of rows) {
      const g = by.get(r.supplierId) ?? { supplier: r.supplier, ids: [], amount: 0 };
      g.ids.push(r.id);
      g.amount += r.transferred;
      by.set(r.supplierId, g);
    }
    const suppliers = [...by.values()].map((g) => {
      const problem = g.amount <= 0 ? 'Итог не положительный — зачтётся в следующих продажах' : !g.supplier.payoutAccount || !g.supplier.payoutBik ? 'Нет банковских реквизитов' : null;
      return {
        supplierId: g.supplier.id, legalName: g.supplier.legalName, inn: g.supplier.inn, rows: g.ids.length, amount: g.amount, problem, ids: g.ids,
        details: g.supplier.payoutAccount ? { legalName: g.supplier.payoutLegalName, bik: g.supplier.payoutBik, account: maskAccount(g.supplier.payoutAccount) } : null,
      };
    });
    return { suppliers, waiting: { rows: waiting._count, amount: waiting._sum.transferred ?? 0 } };
  }

  async overview() {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: 'payouts' } });
    const mode = (row?.value as { mode?: string; reason?: string; since?: string } | undefined) ?? {};
    const registries = await this.prisma.payoutRegistry.findMany({ orderBy: { number: 'desc' }, take: 30, include: { _count: { select: { payouts: true } } } });
    const p = await this.pending();
    return {
      mode: { mode: mode.mode ?? 'split', reason: mode.reason ?? null, since: mode.since ?? null },
      pending: { ...p, suppliers: p.suppliers.map(({ ids: _ids, ...s }) => s) },
      registries: registries.map((r) => ({ id: r.id, number: r.number, total: r.total, rows: r._count.payouts, createdAt: r.createdAt, paidAt: r.paidAt })),
    };
  }

  async setMode(mode: 'split' | 'registry', reason: string, admin: User) {
    const cur = await this.settings.payoutsMode();
    if (cur === mode) throw new BadRequestException({ message: mode === 'registry' ? 'Аварийный режим уже включён' : 'Сплит уже включён' });
    await this.settings.setPayoutsMode(mode, reason, admin.id);
    await this.audit.log(admin.id, `payouts.mode.${mode}`, 'setting', 'payouts', { reason });
    await this.alerts.send(
      mode === 'registry' ? 'Включён аварийный режим выплат' : 'Выплаты снова через сплит',
      `${admin.email}: ${reason}\n${mode === 'registry' ? 'Новые заказы оплачиваются без сплита, поставщикам — реестром из админки.' : 'Новые заказы — со сплитом ЮKassa. Заказы аварийного режима по-прежнему выплачиваются реестром.'}`,
    );
    return this.overview();
  }

  /** Сформировать реестр: только поставщики с положительным итогом и реквизитами */
  async create(admin: User) {
    const { suppliers } = await this.pending();
    const ok = suppliers.filter((s) => !s.problem);
    if (!ok.length) throw new BadRequestException({ message: 'Нечего включать в реестр' });
    const ids = ok.flatMap((s) => s.ids);
    const total = ok.reduce((sum, s) => sum + s.amount, 0);
    const reg = await this.prisma.$transaction(async (tx) => {
      const r = await tx.payoutRegistry.create({ data: { total, createdBy: admin.id } });
      // Условие registryId: null — защита от двойного включения строки при параллельном формировании
      const u = await tx.payout.updateMany({ where: { id: { in: ids }, registryId: null }, data: { registryId: r.id } });
      if (u.count !== ids.length) throw new BadRequestException({ message: 'Строки изменились, сформируйте реестр заново' });
      return r;
    });
    await this.audit.log(admin.id, 'payouts.registry.create', 'payout_registry', reg.id, { number: reg.number, total, suppliers: ok.length });
    return this.overview();
  }

  private async registry(id: string) {
    const r = await this.prisma.payoutRegistry.findUnique({ where: { id }, include: { payouts: { include: { supplier: true, shipment: { include: { order: true } } }, orderBy: { createdAt: 'asc' } } } });
    if (!r) throw new NotFoundException();
    return r;
  }

  /** CSV для загрузки платёжных поручений в банк (разделитель «;», UTF-8 с BOM) */
  async csv(id: string, admin: User) {
    const r = await this.registry(id);
    const by = new Map<string, { s: (typeof r.payouts)[number]['supplier']; amount: number; shipments: string[] }>();
    for (const p of r.payouts) {
      const g = by.get(p.supplierId) ?? { s: p.supplier, amount: 0, shipments: [] };
      g.amount += p.transferred;
      g.shipments.push(`${p.shipment.order.number}-${p.shipment.no}`);
      by.set(p.supplierId, g);
    }
    const rub = (k: number) => (k / 100).toFixed(2).replace('.', ',');
    const cell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      'N;Получатель;ИНН;БИК;Счёт;Сумма;Назначение платежа',
      ...[...by.values()].map((g, i) =>
        [String(i + 1), g.s.payoutLegalName ?? g.s.legalName, g.s.payoutInn ?? g.s.inn, g.s.payoutBik ?? '', g.s.payoutAccount ?? '', rub(g.amount), `Перечисление по агентскому договору, реестр ${r.number}, отправления ${[...new Set(g.shipments)].join(', ')}. Без НДС`]
          .map(cell)
          .join(';'),
      ),
    ];
    // Выгрузка содержит полные номера счетов — фиксируем, кто скачал
    await this.audit.log(admin.id, 'payouts.registry.export', 'payout_registry', r.id, { number: r.number });
    return { csv: `﻿${lines.join('\r\n')}\r\n`, name: `reestr-vyplat-${r.number}.csv` };
  }

  async markPaid(id: string, admin: User) {
    const r = await this.registry(id);
    if (r.paidAt) throw new BadRequestException({ message: 'Реестр уже отмечен оплаченным' });
    await this.prisma.payoutRegistry.update({ where: { id }, data: { paidAt: new Date(), paidBy: admin.id } });
    await this.audit.log(admin.id, 'payouts.registry.paid', 'payout_registry', id, { number: r.number, total: r.total });
    return this.overview();
  }

  /** Отменить неоплаченный реестр — строки вернутся в очередь */
  async remove(id: string, admin: User) {
    const r = await this.registry(id);
    if (r.paidAt) throw new BadRequestException({ message: 'Оплаченный реестр отменить нельзя' });
    await this.prisma.$transaction([this.prisma.payout.updateMany({ where: { registryId: id }, data: { registryId: null } }), this.prisma.payoutRegistry.delete({ where: { id } })]);
    await this.audit.log(admin.id, 'payouts.registry.cancel', 'payout_registry', id, { number: r.number, total: r.total, sum: formatRub(r.total) });
    return this.overview();
  }
}
