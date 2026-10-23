import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { formatRub } from '@aesculap/shared';
import { Prisma, type User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertService } from '../common/alert.service';
import { AuditService } from '../common/audit.service';
import { JobsService } from '../common/jobs.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { OrdersService } from './orders.service';

const DAY = 86400000;

/** Заказы и платежи в админке (ТЗ §8): поиск, статусы, ручная отмена и возврат, сверка с ЮKassa. */
@Injectable()
export class AdminOrdersService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminOrders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly alerts: AlertService,
    private readonly jobs: JobsService,
  ) {}

  /** Ежедневная сверка за двое суток: расхождения — алертом дежурному (ТЗ §10: «ежедневная сверка») */
  async onApplicationBootstrap() {
    this.jobs.register('payments.reconcile', async () => {
      const r = await this.reconcile(new Date(Date.now() - 2 * DAY), new Date());
      if (r.mismatches.length) {
        await this.alerts.send(`Сверка платежей: ${r.mismatches.length} расхождений`, r.mismatches.map((m) => `${m.number}: ${m.problem}`).join('\n'));
      }
    });
    await this.jobs.repeat('payments.reconcile', DAY);
  }

  async search(q: { q?: string; status?: string }) {
    const term = q.q?.trim();
    const where: Prisma.OrderWhereInput = {};
    if (q.status === 'pending_payment' || q.status === 'paid' || q.status === 'cancelled') where.status = q.status;
    if (q.status === 'problem') where.OR = [{ shipments: { some: { status: 'new', paidAt: { lt: new Date(Date.now() - DAY) } } } }, { shipments: { some: { returns: { some: { status: 'requested' } } } } }];
    if (term) {
      const digits = term.replace(/\D/g, '');
      where.AND = [
        {
          OR: [
            { number: { contains: term.split('-')[0] } },
            { recipientEmail: { contains: term, mode: 'insensitive' } },
            { recipientName: { contains: term, mode: 'insensitive' } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
            ...(digits.length >= 4 ? [{ recipientPhone: { contains: digits.slice(-10) } }] : []),
            { shipments: { some: { trackNo: term } } },
          ],
        },
      ];
    }
    const rows = await this.prisma.order.findMany({ where, include: { shipments: { include: { supplier: true } }, user: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((o) => ({
      number: o.number, createdAt: o.createdAt, status: o.status, paymentStatus: o.paymentStatus, total: o.total, customer: o.recipientName, email: o.user.email,
      shipments: o.shipments.map((s) => ({ no: s.no, status: s.status, supplier: s.supplier.legalName })),
    }));
  }

  private async load(number: string) {
    const o = await this.prisma.order.findUnique({
      where: { number },
      include: {
        user: true,
        refunds: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { no: 'asc' }, include: { supplier: true, items: true, events: { orderBy: { at: 'asc' } }, payouts: { orderBy: { createdAt: 'asc' } }, returns: true } },
      },
    });
    if (!o) throw new NotFoundException({ message: 'Заказ не найден' });
    return o;
  }

  async view(number: string) {
    const o = await this.load(number);
    return {
      number: o.number, status: o.status, paymentStatus: o.paymentStatus, paymentId: o.paymentId, paymentMethod: o.paymentMethod, settlement: o.settlement, createdAt: o.createdAt, paidAt: o.paidAt,
      expiresAt: o.expiresAt, cancelReason: o.cancelReason, goodsTotal: o.goodsTotal, deliveryTotal: o.deliveryTotal, total: o.total,
      customer: { email: o.user.email, name: o.recipientName, phone: o.recipientPhone, recipientEmail: o.recipientEmail, deleted: Boolean(o.user.deletedAt) },
      refunds: o.refunds.map((r) => ({ id: r.id, amount: r.amount, reason: r.reason, status: r.status, providerRefundId: r.providerRefundId, createdAt: r.createdAt })),
      shipments: o.shipments.map((s) => ({
        no: s.no, supplier: s.supplier.legalName, status: s.status, deliveryType: s.deliveryType, address: s.address, trackNo: s.trackNo, cdekUuid: s.cdekUuid,
        goodsTotal: s.goodsTotal, deliveryPrice: s.deliveryPrice, commission: s.commission,
        items: s.items.map((i) => ({ id: i.id, title: i.title, sku: i.sku, size: i.size, color: i.color, price: i.price, qty: i.qty, returnedQty: i.returnedQty, image: this.storage.publicUrl(i.imageKey) })),
        events: s.events.map((e) => ({ status: e.status, note: e.note, at: e.at })),
        payouts: s.payouts.map((p) => ({ kind: p.kind, amountGoods: p.amountGoods, commission: p.commission, transferred: p.transferred, createdAt: p.createdAt })),
        returns: s.returns.map((r) => ({ status: r.status, amount: r.amount, reason: r.reason })),
      })),
    };
  }

  /** Ручная отмена отправления поддержкой — с возвратом денег сплит-платежа */
  async cancel(number: string, no: number, reason: string, admin: User) {
    const o = await this.load(number);
    const s = o.shipments.find((x) => x.no === no);
    if (!s) throw new NotFoundException();
    await this.orders.cancelShipment(s.id, 'cancelled', `Отменено поддержкой: ${reason}`, { force: true });
    await this.audit.log(admin.id, 'order.cancel.admin', 'shipment', s.id, { number, reason });
    return this.view(number);
  }

  /** Частичный возврат без заявки покупателя (брак, пересорт, компенсация доставки) */
  async refund(number: string, no: number, input: { items: { itemId: string; qty: number }[]; withDelivery: boolean; reason: string }, admin: User) {
    const o = await this.load(number);
    if (o.status !== 'paid') throw new BadRequestException({ message: 'Возврат возможен только по оплаченному заказу' });
    const s = o.shipments.find((x) => x.no === no);
    if (!s) throw new NotFoundException();
    if (!input.items.length && !input.withDelivery) throw new BadRequestException({ message: 'Выберите товары или доставку' });
    const lines = input.items.map((x) => ({ item: s.items.find((i) => i.id === x.itemId)!, qty: x.qty }));
    if (lines.some((l) => !l.item)) throw new BadRequestException({ message: 'Позиция не из этого отправления' });
    // Доставка возвращается один раз: в прежнем возврате её доля — сумма сверх стоимости товаров
    if (input.withDelivery && (await this.prisma.refund.findMany({ where: { shipmentId: s.id, status: { not: 'canceled' } } })).some((r) => r.amount > r.goodsAmount)) {
      throw new BadRequestException({ message: 'Доставка по этому отправлению уже возвращена' });
    }
    // Резервируем количество к возврату атомарно, как при возврате по заявке
    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        const n = await tx.$executeRaw`UPDATE shipment_items SET "returnedQty" = "returnedQty" + ${l.qty} WHERE id = ${l.item.id}::uuid AND "returnedQty" + ${l.qty} <= qty`;
        if (n === 0) throw new BadRequestException({ message: `«${l.item.title}»: к возврату больше, чем осталось` });
      }
    });
    try {
      await this.orders.refund({ ...s, order: o }, lines, input.withDelivery, `Возврат поддержкой: ${input.reason}`, `manual:${randomUUID()}`);
    } catch (e) {
      await this.prisma.$transaction(lines.map((l) => this.prisma.shipmentItem.update({ where: { id: l.item.id }, data: { returnedQty: { decrement: l.qty } } })));
      throw e;
    }
    await this.prisma.shipmentEvent.create({ data: { shipmentId: s.id, status: 'refund_manual', note: input.reason } });
    await this.audit.log(admin.id, 'order.refund.admin', 'shipment', s.id, { number, ...input });
    return this.view(number);
  }

  /** Перечитать платёж в платёжке — если вебхук потерялся */
  async syncPayment(number: string, admin: User) {
    const o = await this.load(number);
    if (!o.paymentId) throw new BadRequestException({ message: 'У заказа нет платежа' });
    await this.orders.handlePayment(o.paymentId);
    await this.audit.log(admin.id, 'order.payment.sync', 'order', o.id);
    return this.view(number);
  }

  /** Сверка с платёжкой за период: статус и сумма каждого платежа против заказа */
  async reconcile(from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({ where: { createdAt: { gte: from, lt: to }, paymentId: { not: null } }, take: 2000 });
    const mismatches: { number: string; problem: string }[] = [];
    let ok = 0;
    for (const o of orders) {
      const st = await this.orders.payments.getPayment(o.paymentId!).catch(() => null);
      if (!st) {
        mismatches.push({ number: o.number, problem: 'платёж не найден в платёжке' });
        continue;
      }
      if (st.status === 'succeeded' && o.status === 'pending_payment') mismatches.push({ number: o.number, problem: 'оплачен в платёжке, у нас «ждёт оплаты» — потерян вебхук' });
      else if (st.status === 'succeeded' && o.status === 'cancelled' && !(await this.prisma.refund.count({ where: { orderId: o.id } })))
        mismatches.push({ number: o.number, problem: 'оплачен, но заказ отменён без возврата' });
      else if (st.status !== 'succeeded' && o.status === 'paid') mismatches.push({ number: o.number, problem: `у нас «оплачен», в платёжке — ${st.status}` });
      else if (st.status === 'succeeded' && st.amount !== o.total) mismatches.push({ number: o.number, problem: `сумма: платёж ${formatRub(st.amount)}, заказ ${formatRub(o.total)}` });
      else ok++;
    }
    return { from, to, checked: orders.length, ok, mismatches };
  }
}
