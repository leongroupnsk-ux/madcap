import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SHIPMENT_FLOW, maskAccount, type PayoutDetailsInput } from '@aesculap/shared';
import type { Prisma, ShipmentStatus, Supplier, User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { DeliveryService, parcelOf } from '../delivery/delivery.service';
import { OrdersService } from './orders.service';

const HOUR = 3600000;
const ACTIVE_DELIVERY: ShipmentStatus[] = ['handed_over', 'in_transit', 'ready_for_pickup'];
const rank = (s: string) => SHIPMENT_FLOW.indexOf(s as (typeof SHIPMENT_FLOW)[number]);

/** Заказы и выплаты в кабинете поставщика (ТЗ §7.5, §7.8). Всё — только в контексте своего поставщика. */
@Injectable()
export class SupplierOrdersService {
  private readonly logger = new Logger('SupplierOrders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly delivery: DeliveryService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async own(supplier: Supplier, id: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { id, supplierId: supplier.id, status: { not: 'awaiting_payment' } },
      include: { items: true, order: true, supplier: true, events: { orderBy: { at: 'asc' } }, returns: { orderBy: { createdAt: 'desc' } } },
    });
    if (!s) throw new NotFoundException({ message: 'Отправление не найдено' });
    return s;
  }

  async list(supplier: Supplier, q: { status?: string; q?: string }) {
    const where: Prisma.ShipmentWhereInput = { supplierId: supplier.id, status: { not: 'awaiting_payment' } };
    if (q.status === 'action') where.status = { in: ['new', 'confirmed', 'packed'] };
    else if (q.status === 'returns') where.returns = { some: { status: 'requested' } };
    else if (q.status && q.status !== 'all') where.status = q.status as ShipmentStatus;
    const search = q.q?.trim();
    if (search) where.order = { OR: [{ number: { contains: search.split('-')[0] } }, { recipientName: { contains: search, mode: 'insensitive' } }] };
    const rows = await this.prisma.shipment.findMany({
      where,
      include: { items: true, order: true, returns: { where: { status: 'requested' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const now = Date.now();
    return {
      items: rows.map((s) => ({
        id: s.id,
        number: `${s.order.number}-${s.no}`,
        createdAt: s.createdAt,
        paidAt: s.paidAt,
        status: s.status,
        overdue: s.status === 'new' && !!s.paidAt && now - s.paidAt.getTime() > 24 * HOUR,
        returnRequested: s.returns.length > 0,
        items: s.items.map((i) => `${i.title}, ${i.size} × ${i.qty}`),
        goodsTotal: s.goodsTotal,
        deliveryType: s.deliveryType,
        address: s.address,
        eta: s.eta,
        customer: s.order.recipientName,
        trackNo: s.trackNo,
      })),
    };
  }

  async detail(supplier: Supplier, id: string) {
    const s = await this.own(supplier, id);
    // Контакты покупателя видны только пока заказ исполняется (ТЗ §7.5).
    const showContacts = !['delivered', 'cancelled', 'rejected'].includes(s.status) || s.returns.some((r) => r.status === 'requested');
    return {
      id: s.id,
      number: `${s.order.number}-${s.no}`,
      status: s.status,
      createdAt: s.createdAt,
      paidAt: s.paidAt,
      overdue: s.status === 'new' && !!s.paidAt && Date.now() - s.paidAt.getTime() > 24 * HOUR,
      goodsTotal: s.goodsTotal,
      commission: s.commission,
      commissionBp: s.commissionBp,
      deliveryType: s.deliveryType,
      address: s.address,
      deliveryPrice: s.deliveryPrice,
      eta: s.eta,
      trackNo: s.trackNo,
      hasWaybill: Boolean(s.cdekUuid),
      rejectReason: s.rejectReason,
      customer: showContacts ? { name: s.order.recipientName, phone: s.order.recipientPhone, email: s.order.recipientEmail } : { name: s.order.recipientName, phone: null, email: null },
      items: s.items.map((i) => ({ id: i.id, sku: i.sku, title: i.title, size: i.size, heightRange: i.heightRange, color: i.color, price: i.price, qty: i.qty, returnedQty: i.returnedQty, image: this.storage.publicUrl(i.imageKey) })),
      events: s.events.map((e) => ({ status: e.status, note: e.note, at: e.at })),
      returns: s.returns.map((r) => ({
        id: r.id, status: r.status, amount: r.amount, reason: r.reason, rejectReason: r.rejectReason, createdAt: r.createdAt,
        items: (r.items as { itemId: string; qty: number }[]).map((x) => ({ ...x, title: s.items.find((i) => i.id === x.itemId)?.title ?? '' })),
      })),
    };
  }

  private async move(supplier: Supplier, id: string, from: ShipmentStatus, to: ShipmentStatus, note: string, actor: User, extra: Prisma.ShipmentUpdateManyMutationInput = {}) {
    const r = await this.prisma.shipment.updateMany({ where: { id, supplierId: supplier.id, status: from }, data: { status: to, ...extra } });
    if (r.count === 0) throw new ConflictException({ message: 'Статус отправления уже изменился — обновите страницу' });
    await this.prisma.shipmentEvent.create({ data: { shipmentId: id, status: to, note } });
    await this.audit.log(actor.id, `shipment.${to}`, 'shipment', id, {});
    return this.detail(supplier, id);
  }

  confirm(supplier: Supplier, id: string, actor: User) {
    return this.move(supplier, id, 'new', 'confirmed', 'Поставщик подтвердил заказ', actor, { confirmedAt: new Date() });
  }

  pack(supplier: Supplier, id: string, actor: User) {
    return this.move(supplier, id, 'confirmed', 'packed', 'Заказ упакован', actor);
  }

  async reject(supplier: Supplier, id: string, reason: string, actor: User) {
    const s = await this.own(supplier, id);
    if (!['new', 'confirmed'].includes(s.status)) throw new BadRequestException({ message: 'Отклонить можно только до упаковки' });
    await this.orders.cancelShipment(s.id, 'rejected', reason);
    await this.audit.log(actor.id, 'shipment.reject', 'shipment', id, { reason });
    return this.detail(supplier, id);
  }

  /** «Накладная СДЭК»: заказ в СДЭК, после чего отправление считается переданным в доставку. */
  async waybill(supplier: Supplier, id: string, actor: User) {
    const s = await this.own(supplier, id);
    if (s.status !== 'packed') throw new BadRequestException({ message: 'Сначала отметьте заказ упакованным' });
    if (!s.cdekUuid) {
      if (this.delivery.provider.name === 'cdek' && !supplier.cdekShipmentPoint) {
        throw new BadRequestException({ message: 'Укажите в настройках пункт СДЭК, куда сдаёте посылки' });
      }
      const addr = s.addressJson as { street?: string; flat?: string; city?: string };
      const created = await this.delivery.provider.createOrder({
        number: `${s.order.number}-${s.no}`,
        tariffCode: s.tariffCode,
        shipmentPoint: supplier.cdekShipmentPoint ?? '',
        to: { type: s.deliveryType, cityCode: s.cityCode, pvzCode: s.pvzCode, address: [addr.street, addr.flat && `кв. ${addr.flat}`].filter(Boolean).join(', ') },
        recipient: { name: s.order.recipientName, phone: s.order.recipientPhone, email: s.order.recipientEmail },
        seller: { name: supplier.legalName, inn: supplier.inn, phone: supplier.contactPhone ?? '' },
        parcel: parcelOf(s.items.map((i) => ({ qty: i.qty, weightG: i.weightG }))),
        items: s.items.map((i) => ({ name: `${i.title}, ${i.size}`, sku: i.sku, price: i.price, qty: i.qty, weightG: i.weightG })),
      });
      await this.prisma.shipment.update({ where: { id: s.id }, data: { cdekUuid: created.uuid } });
    }
    await this.move(supplier, id, 'packed', 'handed_over', 'Создана накладная СДЭК', actor);
    await this.sync(s.id).catch(() => undefined);
    return this.detail(supplier, id);
  }

  async document(supplier: Supplier, id: string, kind: 'waybill' | 'barcode') {
    const s = await this.own(supplier, id);
    if (!s.cdekUuid) throw new BadRequestException({ message: 'Накладная ещё не создана' });
    return { pdf: await this.delivery.provider.print(s.cdekUuid, kind), name: `${kind === 'waybill' ? 'nakladnaya' : 'etiketka'}-${s.order.number}-${s.no}.pdf` };
  }

  /** Статус из СДЭК: трек, движение по статусам вперёд, событие в таймлайн (ТЗ §10). */
  async sync(shipmentId: string) {
    const s = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!s?.cdekUuid) return;
    const st = await this.delivery.provider.getOrder(s.cdekUuid);
    const data: Prisma.ShipmentUpdateInput = {};
    if (st.trackNo && st.trackNo !== s.trackNo) data.trackNo = st.trackNo;
    const forward = st.status && rank(st.status) > rank(s.status) && ACTIVE_DELIVERY.includes(s.status);
    if (forward) {
      data.status = st.status!;
      if (st.status === 'delivered') data.deliveredAt = new Date();
    }
    if (!Object.keys(data).length) return;
    await this.prisma.shipment.update({ where: { id: s.id }, data });
    if (forward) await this.prisma.shipmentEvent.create({ data: { shipmentId: s.id, status: st.status!, note: st.statusName ?? undefined } });
    else if (data.trackNo) await this.prisma.shipmentEvent.create({ data: { shipmentId: s.id, status: 'track', note: `Трек-номер СДЭК: ${st.trackNo}` } });
  }

  async syncByCdekUuid(uuid: string) {
    const s = await this.prisma.shipment.findUnique({ where: { cdekUuid: uuid } });
    if (s) await this.sync(s.id);
  }

  /** Опрос раз в час — на случай потерянных вебхуков СДЭК. */
  async pollAll() {
    const rows = await this.prisma.shipment.findMany({ where: { status: { in: ACTIVE_DELIVERY }, cdekUuid: { not: null } }, select: { id: true }, take: 500 });
    for (const r of rows) await this.sync(r.id).catch((e) => this.logger.warn(`sync ${r.id}: ${e.message}`));
    return rows.length;
  }

  // ─── возвраты ────────────────────────────────────────────────────────

  async decideReturn(supplier: Supplier, returnId: string, approve: boolean, reason: string | undefined, actor: User) {
    const rr = await this.prisma.returnRequest.findFirst({ where: { id: returnId, shipment: { supplierId: supplier.id } }, include: { shipment: { include: { items: true, supplier: true, order: true } } } });
    if (!rr) throw new NotFoundException();
    if (rr.status !== 'requested') throw new ConflictException({ message: 'Заявка уже рассмотрена' });
    if (!approve) {
      if (!reason) throw new BadRequestException({ message: 'Укажите причину отказа', errors: { reason: 'Укажите причину' } });
      await this.prisma.returnRequest.update({ where: { id: rr.id }, data: { status: 'rejected', rejectReason: reason, decidedAt: new Date() } });
      await this.prisma.shipmentEvent.create({ data: { shipmentId: rr.shipmentId, status: 'return_rejected', note: reason } });
    } else {
      const lines = (rr.items as { itemId: string; qty: number }[]).map((x) => ({ item: rr.shipment.items.find((i) => i.id === x.itemId)!, qty: x.qty }));
      await this.orders.refund(rr.shipment, lines, false, `Возврат: ${rr.reason}`, `return:${rr.id}`);
      await this.prisma.$transaction([
        ...lines.map((l) => this.prisma.shipmentItem.update({ where: { id: l.item.id }, data: { returnedQty: { increment: l.qty } } })),
        this.prisma.returnRequest.update({ where: { id: rr.id }, data: { status: 'approved', decidedAt: new Date() } }),
        this.prisma.shipmentEvent.create({ data: { shipmentId: rr.shipmentId, status: 'return_approved', note: `Возврат принят, деньги возвращены` } }),
      ]);
    }
    await this.audit.log(actor.id, approve ? 'return.approve' : 'return.reject', 'return', rr.id, { reason });
    return this.detail(supplier, rr.shipmentId);
  }

  // ─── выплаты ─────────────────────────────────────────────────────────

  async payouts(supplier: Supplier, q: { from?: string; to?: string }) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = q.from ? new Date(q.from) : new Date(now.getTime() - 90 * 86400000);
    const to = q.to ? new Date(new Date(q.to).getTime() + 86400000) : new Date(now.getTime() + 60000);
    const [rows, month] = await Promise.all([
      this.prisma.payout.findMany({ where: { supplierId: supplier.id, createdAt: { gte: from, lt: to } }, include: { shipment: { include: { order: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.payout.aggregate({ where: { supplierId: supplier.id, createdAt: { gte: monthStart } }, _sum: { transferred: true } }),
    ]);
    return {
      payoutStatus: supplier.payoutStatus,
      accountId: supplier.yookassaAccountId,
      commissionBp: supplier.commissionBp,
      monthTransferred: month._sum.transferred ?? 0,
      details: supplier.payoutLegalName
        ? { legalName: supplier.payoutLegalName, inn: supplier.payoutInn, account: maskAccount(supplier.payoutAccount), bik: supplier.payoutBik, requestedAt: supplier.payoutRequestedAt }
        : null,
      items: rows.map((p) => ({
        id: p.id, kind: p.kind, number: `${p.shipment.order.number}-${p.shipment.no}`, shipmentId: p.shipmentId,
        amountGoods: p.amountGoods, commission: p.commission, transferred: p.transferred, createdAt: p.createdAt,
      })),
    };
  }

  /** Отчёт агента за месяц (CSV, разделитель «;» — открывается в Excel). */
  async report(supplier: Supplier, month: string) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) throw new BadRequestException({ message: 'Месяц в формате ГГГГ-ММ' });
    const from = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    const to = new Date(Number(m[1]), Number(m[2]), 1);
    const rows = await this.prisma.payout.findMany({ where: { supplierId: supplier.id, createdAt: { gte: from, lt: to } }, include: { shipment: { include: { order: true } } }, orderBy: { createdAt: 'asc' } });
    const rub = (k: number) => (k / 100).toFixed(2).replace('.', ',');
    const lines = [
      `Отчёт агента;${supplier.legalName};ИНН ${supplier.inn};${month}`,
      'Дата;Отправление;Операция;Сумма товаров;Вознаграждение агента;Перечислено принципалу',
      ...rows.map((p) => [p.createdAt.toLocaleDateString('ru-RU'), `${p.shipment.order.number}-${p.shipment.no}`, p.kind === 'sale' ? 'Продажа' : 'Возврат', rub(p.amountGoods), rub(p.commission), rub(p.transferred)].join(';')),
      ['Итого', '', '', rub(rows.reduce((s, p) => s + p.amountGoods, 0)), rub(rows.reduce((s, p) => s + p.commission, 0)), rub(rows.reduce((s, p) => s + p.transferred, 0))].join(';'),
    ];
    return { csv: `﻿${lines.join('\r\n')}\r\n`, name: `otchet-agenta-${month}.csv` };
  }

  /** Новые реквизиты = повторная проверка в ЮKassa: выплаты на паузе до подтверждения (ТЗ §7.8). */
  async setDetails(supplier: Supplier, input: PayoutDetailsInput, actor: User) {
    await this.prisma.supplier.update({
      where: { id: supplier.id },
      data: { payoutLegalName: input.legalName, payoutInn: input.inn, payoutAccount: input.account, payoutBik: input.bik, payoutRequestedAt: new Date(), payoutStatus: 'in_review' },
    });
    await this.audit.log(actor.id, 'supplier.payout_details', 'supplier', supplier.id, { inn: input.inn, bik: input.bik, account: maskAccount(input.account) });
    return this.payouts(await this.prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } }), {});
  }

  /** Плитки дашборда по заказам */
  async counters(supplier: Supplier) {
    const day = new Date(Date.now() - 24 * HOUR);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [fresh, overdue, toShip, returns, sales, zeroInCapsules] = await Promise.all([
      this.prisma.shipment.count({ where: { supplierId: supplier.id, status: 'new' } }),
      this.prisma.shipment.count({ where: { supplierId: supplier.id, status: 'new', paidAt: { lt: day } } }),
      this.prisma.shipment.count({ where: { supplierId: supplier.id, status: { in: ['confirmed', 'packed'] } } }),
      this.prisma.returnRequest.count({ where: { status: 'requested', shipment: { supplierId: supplier.id } } }),
      // Продажи за месяц — оплаченные товары за вычетом возвратов (по строкам выплат)
      this.prisma.payout.aggregate({ where: { supplierId: supplier.id, createdAt: { gte: monthStart } }, _sum: { amountGoods: true } }),
      this.prisma.product.count({ where: { supplierId: supplier.id, variants: { some: { stock: 0, capsuleItems: { some: {} } } } } }),
    ]);
    return { fresh, overdue, toShip, returns, salesMonth: sales._sum.amountGoods ?? 0, zeroInCapsules };
  }
}
