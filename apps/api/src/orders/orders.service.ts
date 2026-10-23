import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CANCELLABLE_SHIPMENT, RETURN_DAYS, formatRub, plural, type AddressInput, type CartLineInput, type CheckoutInput } from '@aesculap/shared';
import { Prisma, type Order, type Shipment, type ShipmentItem, type ShipmentStatus, type Supplier, type User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { parcelOf, DeliveryService } from '../delivery/delivery.service';
import { PAYMENTS_PROVIDER, type PaymentsProvider, type Receipt, type Transfer } from '../payments/payments.provider';
import { CartService, type CheckedLine } from './cart.service';

const DAY = 86400000;
type FullShipment = Shipment & { items: ShipmentItem[]; supplier: Supplier };
type FullOrder = Order & { shipments: FullShipment[] };

const commissionOf = (goods: number, bp: number) => Math.round((goods * bp) / 10000);
/** Комиссия по позициям: у акционных — льготная ставка акции (ТЗ §7.7) */
const commissionOfLines = (lines: { price: number; qty: number; commissionBp: number }[]) => lines.reduce((s, l) => s + commissionOf(l.price * l.qty, l.commissionBp), 0);

export function addressLine(a: AddressInput) {
  if (a.type === 'pvz') return `${a.city}, ${a.pvzAddress ?? a.pvzCode} (${a.pvzCode})`;
  return [a.city, a.street, a.flat && `кв./офис ${a.flat}`].filter(Boolean).join(', ');
}

/** Заказы покупателя (ТЗ §6.2–6.6): оформление, резерв, оплата по вебхуку, отмена и возвраты. */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly delivery: DeliveryService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    @Inject(PAYMENTS_PROVIDER) readonly payments: PaymentsProvider,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ─── оформление ──────────────────────────────────────────────────────

  private group(lines: CheckedLine[]) {
    const groups = new Map<string, CheckedLine[]>();
    for (const l of lines) groups.set(l.supplier.id, [...(groups.get(l.supplier.id) ?? []), l]);
    return groups;
  }

  /** Варианты доставки для каждого поставщика в выбранный город (ТЗ §6.2). */
  async quote(lines: CartLineInput[], cityCode: number) {
    const checked = (await this.cart.check(lines)).filter((l) => l.available);
    const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: checked.map((l) => l.supplier.id) } } });
    const out = [];
    for (const [supplierId, items] of this.group(checked)) {
      const s = suppliers.find((x) => x.id === supplierId)!;
      const parcel = parcelOf(items.map((i) => ({ ...i, qty: Math.min(i.qty, i.stock) })));
      const options = s.cdekCityCode ? await this.delivery.quote(s.cdekCityCode, cityCode, parcel) : [];
      out.push({ supplierId, options: options.map((o) => ({ ...o, periodMin: o.periodMin + s.shipDays, periodMax: o.periodMax + s.shipDays })) });
    }
    return out;
  }

  async create(user: User, lines: CartLineInput[], input: CheckoutInput) {
    const checked = await this.cart.check(lines);
    if (!checked.length) throw new BadRequestException({ message: 'Корзина пуста' });
    const problems = checked.filter((l) => !l.available || l.qty > l.stock);
    if (problems.length) {
      throw new ConflictException({ message: `Изменилось наличие: ${problems.map((p) => p.product.title).join(', ')}. Обновите корзину.`, code: 'cart_changed' });
    }
    const groups = this.group(checked);
    const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: [...groups.keys()] } } });

    // Аварийный режим (сбой сплита ЮKassa): оплату принимает платформа, поставщикам — реестром (ТЗ §8)
    const settlement = await this.settings.payoutsMode();
    const plan: { supplier: Supplier; items: CheckedLine[]; address: AddressInput; tariffCode: number; price: number; periodMin: number; periodMax: number; goods: number }[] = [];
    for (const [supplierId, items] of groups) {
      const supplier = suppliers.find((s) => s.id === supplierId)!;
      const address = input.delivery[supplierId];
      if (!address) throw new BadRequestException({ message: `Выберите доставку для отправления от «${supplier.legalName}»` });
      if (!supplier.cdekCityCode) throw new BadRequestException({ message: `Поставщик «${supplier.legalName}» не указал склад отгрузки` });
      if (this.payments.name === 'yookassa' && (settlement === 'split' ? !supplier.yookassaAccountId : !supplier.payoutAccount)) throw new BadRequestException({ message: `Поставщик «${supplier.legalName}» временно не принимает оплату` });
      if (address.type === 'pvz') {
        // Пункт выдачи должен быть в городе, по которому считается тариф; адрес пункта берём из СДЭК, а не от клиента.
        const point = (await this.delivery.points(address.cityCode)).find((pt) => pt.code === address.pvzCode);
        if (!point) throw new BadRequestException({ message: `Пункт выдачи не найден в городе ${address.city} — выберите его заново` });
        address.pvzAddress = point.address;
      }
      const quotes = await this.delivery.quote(supplier.cdekCityCode, address.cityCode, parcelOf(items));
      const q = quotes.find((x) => x.type === address.type);
      if (!q) throw new BadRequestException({ message: `СДЭК не доставляет ${address.type === 'pvz' ? 'в пункт выдачи' : 'курьером'} в ${address.city}` });
      const goods = items.reduce((s, i) => s + i.price * i.qty, 0);
      plan.push({ supplier, items, address, tariffCode: q.tariffCode, price: q.price, periodMin: q.periodMin + supplier.shipDays, periodMax: q.periodMax + supplier.shipDays, goods });
    }

    const goodsTotal = plan.reduce((s, p) => s + p.goods, 0);
    const deliveryTotal = plan.reduce((s, p) => s + p.price, 0);
    const now = new Date();
    const { payMinutes } = await this.settings.get();

    const order = await this.prisma.$transaction(async (tx) => {
      // Резерв: списываем остаток сразу, условием «остатка хватает» (ТЗ §6.1).
      for (const l of checked) {
        const r = await tx.productVariant.updateMany({ where: { id: l.variantId, stock: { gte: l.qty } }, data: { stock: { decrement: l.qty } } });
        if (r.count === 0) throw new ConflictException({ message: `«${l.product.title}» (${l.size}) закончился. Обновите корзину.`, code: 'cart_changed' });
      }
      const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
      return tx.order.create({
        data: {
          number: String(nextval),
          userId: user.id,
          goodsTotal,
          deliveryTotal,
          total: goodsTotal + deliveryTotal,
          recipientName: input.recipient.name,
          recipientPhone: input.recipient.phone,
          recipientEmail: input.recipient.email,
          expiresAt: new Date(now.getTime() + payMinutes * 60000),
          settlement,
          shipments: {
            create: plan.map((p, i) => ({
              no: i + 1,
              supplierId: p.supplier.id,
              deliveryType: p.address.type,
              tariffCode: p.tariffCode,
              cityCode: p.address.cityCode,
              address: addressLine(p.address),
              pvzCode: p.address.type === 'pvz' ? p.address.pvzCode : null,
              addressJson: p.address as unknown as Prisma.InputJsonValue,
              deliveryPrice: p.price,
              periodMin: p.periodMin,
              periodMax: p.periodMax,
              eta: new Date(now.getTime() + p.periodMax * DAY),
              goodsTotal: p.goods,
              commissionBp: p.supplier.commissionBp,
              commission: commissionOfLines(p.items),
              items: {
                create: p.items.map((l) => ({
                  variantId: l.variantId, productSlug: l.product.slug, title: l.product.title, brand: l.product.brand, sku: l.sku, size: l.size,
                  heightRange: l.heightRange, color: l.color, imageKey: l.product.imageKey, price: l.price, qty: l.qty, fromCapsule: l.fromCapsule, weightG: l.weightG ?? 400,
                  commissionBp: l.commissionBp, promotionId: l.promotionId,
                })),
              },
              events: { create: { status: 'awaiting_payment', note: 'Заказ оформлен' } },
            })),
          },
        },
        include: { shipments: { include: { items: true, supplier: true } } },
      });
    });

    if (input.saveAddresses) await this.saveAddresses(user.id, Object.values(input.delivery));
    await this.notifyZeroStock(checked.map((l) => l.variantId));
    if (!user.phone) await this.prisma.user.update({ where: { id: user.id }, data: { phone: input.recipient.phone } });
    await this.prisma.cartItem.deleteMany({ where: { userId: user.id } });

    try {
      const confirmationUrl = await this.startPayment(order, order.id);
      return { number: order.number, confirmationUrl };
    } catch (e) {
      await this.cancelUnpaid(order.id, 'Платёж не создан');
      throw e;
    }
  }

  private async saveAddresses(userId: string, list: AddressInput[]) {
    const existing = await this.prisma.address.findMany({ where: { userId } });
    for (const a of list) {
      const dup = existing.some((e) => e.type === a.type && e.cityCode === a.cityCode && (a.type === 'pvz' ? e.pvzCode === a.pvzCode : e.street === a.street && (e.flat ?? '') === (a.flat ?? '')));
      if (!dup) existing.push(await this.prisma.address.create({ data: { userId, ...a } }));
    }
  }

  /** Остаток 0 у товара, который стоит в капсулах покупателей (ТЗ §7.9) */
  private async notifyZeroStock(variantIds: string[]) {
    const empty = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, stock: 0, capsuleItems: { some: {} } },
      include: { product: true, _count: { select: { capsuleItems: true } } },
    });
    for (const v of empty) {
      await this.notifications.notify(v.product.supplierId, 'capsule_zero_stock', {
        title: `Закончился ${v.product.title}, ${v.size}`,
        body: `Вариант ${v.sku} стоит в капсулах покупателей: ${v._count.capsuleItems}. Пополните остаток, иначе капсулы подберут замену.`,
        link: `/supplier/products/${v.productId}`,
      });
    }
  }

  // ─── оплата ──────────────────────────────────────────────────────────

  private receipt(order: { recipientEmail: string; recipientPhone: string }, shipments: { no: number; deliveryPrice: number; supplier: Supplier; items: { title: string; size: string; price: number; qty: number }[] }[], withDelivery = true): Receipt {
    return {
      customer: { email: order.recipientEmail, phone: order.recipientPhone },
      items: shipments.flatMap((s) => [
        ...s.items
          .filter((i) => i.qty > 0)
          .map((i) => ({ description: `${i.title}, ${i.size}`, quantity: i.qty, amount: i.price, vatCode: s.supplier.vatCode, subject: 'commodity' as const, supplier: { name: s.supplier.legalName, inn: s.supplier.inn } })),
        ...(withDelivery && s.deliveryPrice > 0 ? [{ description: `Доставка СДЭК, отправление ${s.no}`, quantity: 1, amount: s.deliveryPrice, vatCode: 1, subject: 'service' as const }] : []),
      ]),
    };
  }

  private transfer(s: { supplier: Supplier; no: number }, goods: number, commission: number, orderNumber: string): Transfer {
    return { accountId: s.supplier.yookassaAccountId ?? 'test-account', amount: goods, platformFee: commission, description: `Заказ ${orderNumber}, отправление ${s.no}` };
  }

  /** Платёж со сплитом по отправлениям; доставка остаётся платформе, которая платит СДЭК (ТЗ §10). */
  private async startPayment(order: FullOrder, idempotenceKey: string) {
    const p = await this.payments.createPayment({
      idempotenceKey,
      amount: order.total,
      description: `Заказ № ${order.number}`,
      returnUrl: `${config.webOrigin}/orders/${order.number}/result`,
      metadata: { orderId: order.id, orderNumber: order.number },
      receipt: this.receipt(order, order.shipments),
      transfers: order.settlement === 'split' ? order.shipments.map((s) => this.transfer(s, s.goodsTotal, s.commission, order.number)) : [],
    });
    await this.prisma.order.update({ where: { id: order.id }, data: { paymentId: p.id, paymentStatus: 'pending', confirmationUrl: p.confirmationUrl } });
    return p.confirmationUrl;
  }

  /** Повторная попытка оплаты — новый платёж с новым ключом идемпотентности. */
  async retryPayment(user: User, number: string) {
    const order = await this.full(user, number);
    if (order.status !== 'pending_payment') throw new BadRequestException({ message: 'Заказ уже оплачен или отменён' });
    if (order.expiresAt < new Date()) {
      await this.expire(order.id);
      throw new BadRequestException({ message: 'Время на оплату истекло, заказ отменён' });
    }
    if (order.paymentId) {
      const st = await this.payments.getPayment(order.paymentId);
      if (st.status === 'succeeded') {
        await this.handlePayment(order.paymentId);
        return { number, confirmationUrl: null };
      }
      if (st.status === 'pending' && order.confirmationUrl) return { number, confirmationUrl: order.confirmationUrl };
    }
    return { number, confirmationUrl: await this.startPayment(order, randomUUID()) };
  }

  /**
   * Уведомление о платеже. Статусу из тела вебхука не доверяем — перечитываем платёж
   * в платёжке; повторы безопасны (ТЗ §6.3).
   */
  async handlePayment(paymentId: string) {
    const state = await this.payments.getPayment(paymentId);
    const order =
      (await this.prisma.order.findUnique({ where: { paymentId }, include: { shipments: { include: { items: true, supplier: true } }, user: true } })) ??
      (state.metadata.orderId ? await this.prisma.order.findUnique({ where: { id: state.metadata.orderId }, include: { shipments: { include: { items: true, supplier: true } }, user: true } }) : null);
    if (!order) {
      this.logger.warn(`Платёж ${paymentId} без заказа`);
      return;
    }
    if (state.status === 'succeeded') {
      if (state.amount !== order.total) {
        // Платёж не на ту сумму заказ не оплачивает: разбирается вручную (сверка в ЮKassa)
        this.logger.error(`Сумма платежа ${paymentId} (${state.amount}) не совпала с заказом ${order.number} (${order.total}) — заказ не переведён в «оплачен»`);
        return;
      }
      const now = new Date();
      const updated = await this.prisma.$transaction(async (tx) => {
        const r = await tx.order.updateMany({
          where: { id: order.id, status: 'pending_payment' },
          data: { status: 'paid', paymentStatus: 'succeeded', paymentId, paymentMethod: state.method, paidAt: now },
        });
        if (r.count === 0) return false;
        for (const s of order.shipments) {
          await tx.shipment.update({ where: { id: s.id }, data: { status: 'new', paidAt: now, events: { create: { status: 'new', note: 'Оплата получена' } } } });
          await tx.payout.create({ data: { shipmentId: s.id, supplierId: s.supplierId, kind: 'sale', amountGoods: s.goodsTotal, commission: s.commission, transferred: s.goodsTotal - s.commission, manual: order.settlement === 'registry' } });
        }
        return true;
      });
      if (updated) {
        await this.notifyPaid(order);
        return;
      }
      // Оплата пришла после отмены или вторым платежом — деньги возвращаем целиком.
      const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      if (fresh.paymentId !== paymentId || fresh.status === 'cancelled') {
        const exists = await this.prisma.refund.findUnique({ where: { idempotenceKey: `dup:${paymentId}` } });
        if (!exists) {
          const res = await this.payments.createRefund({
            idempotenceKey: `dup:${paymentId}`,
            paymentId,
            amount: state.amount,
            description: `Возврат лишнего платежа по заказу ${order.number}`,
            sources: order.settlement === 'split' ? order.shipments.map((s) => this.transfer(s, s.goodsTotal, s.commission, order.number)) : [],
            receipt: this.receipt(order, order.shipments),
          });
          await this.prisma.refund.create({
            data: { orderId: order.id, amount: state.amount, goodsAmount: order.goodsTotal, commission: 0, reason: 'Повторный или поздний платёж', providerRefundId: res.id, idempotenceKey: `dup:${paymentId}`, status: res.status },
          });
        }
      }
      return;
    }
    if (state.status === 'canceled' && order.paymentId === paymentId && order.status === 'pending_payment') {
      await this.prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'canceled' } });
    }
  }

  private async notifyPaid(order: FullOrder & { user: User }) {
    const eta = new Date(Math.max(...order.shipments.map((s) => s.eta?.getTime() ?? 0)));
    await this.mail.send({
      to: order.recipientEmail,
      subject: `Заказ № ${order.number} оплачен — ${config.brandName}`,
      text:
        `Спасибо! Заказ № ${order.number} на ${formatRub(order.total)} оплачен.\n` +
        `${order.shipments.length} ${plural(order.shipments.length, 'отправление', 'отправления', 'отправлений')}, доставим ориентировочно ${eta.toLocaleDateString('ru-RU')}.\n` +
        `Детали: ${config.webOrigin}/account/orders/${order.number}`,
    });
    for (const s of order.shipments) {
      await this.notifications.notify(s.supplierId, 'order_paid', {
        title: `Новый заказ № ${order.number}-${s.no}`,
        body: `Оплачено отправление на ${formatRub(s.goodsTotal)}: ${s.items.map((i) => `${i.title}, ${i.size} × ${i.qty}`).join('; ')}. Подтвердите его в течение ${(await this.settings.get()).confirmHours} ч.`,
        link: `/supplier/orders/${s.id}`,
      });
    }
  }

  // ─── отмены и возвраты денег ─────────────────────────────────────────

  private async releaseStock(tx: Prisma.TransactionClient, items: { variantId: string | null; qty: number }[]) {
    for (const i of items) if (i.variantId && i.qty > 0) await tx.productVariant.updateMany({ where: { id: i.variantId }, data: { stock: { increment: i.qty } } });
  }

  /** Неоплаченный заказ: отмена и снятие резерва (ТЗ §6.3). */
  async cancelUnpaid(orderId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.order.updateMany({ where: { id: orderId, status: 'pending_payment' }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } });
      if (r.count === 0) return false;
      const shipments = await tx.shipment.findMany({ where: { orderId }, include: { items: true } });
      for (const s of shipments) {
        await tx.shipment.update({ where: { id: s.id }, data: { status: 'cancelled', events: { create: { status: 'cancelled', note: reason } } } });
        await this.releaseStock(tx, s.items);
      }
      return true;
    });
  }

  /** Перед отменой по таймеру сверяемся с платёжкой: вебхук мог потеряться. */
  async expire(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'pending_payment') return;
    if (order.paymentId) {
      const st = await this.payments.getPayment(order.paymentId).catch(() => null);
      if (st?.status === 'succeeded') return this.handlePayment(order.paymentId);
    }
    await this.cancelUnpaid(orderId, 'Не оплачен вовремя');
  }

  /**
   * Отмена оплаченного отправления с возвратом денег сплит-платежа: товары — из перечисления поставщику,
   * доставка — из доли платформы (ТЗ §6.6, §7.5).
   */
  /** force — отмена поддержкой уже переданного в СДЭК отправления (возврат посылки СДЭК оформляется вручную). */
  async cancelShipment(shipmentId: string, status: Extract<ShipmentStatus, 'cancelled' | 'rejected'>, reason: string, opts: { force?: boolean } = {}) {
    const s = await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { items: true, supplier: true, order: true } });
    const allowed = opts.force ? [...CANCELLABLE_SHIPMENT, 'handed_over', 'in_transit', 'ready_for_pickup'] : CANCELLABLE_SHIPMENT;
    if (!allowed.includes(s.status)) throw new BadRequestException({ message: opts.force ? 'Доставленное или отменённое отправление не отменить — оформите возврат' : 'Отправление уже передано в доставку' });
    const moved = await this.prisma.$transaction(async (tx) => {
      const r = await tx.shipment.updateMany({ where: { id: s.id, status: s.status }, data: { status, ...(status === 'rejected' ? { rejectReason: reason } : {}) } });
      if (r.count === 0) return false;
      await tx.shipmentEvent.create({ data: { shipmentId: s.id, status, note: reason } });
      await this.releaseStock(tx, s.items);
      return true;
    });
    if (!moved) return;
    if (s.order.status === 'paid') await this.refund(s, s.items.filter((i) => i.qty > i.returnedQty).map((i) => ({ item: i, qty: i.qty - i.returnedQty })), true, reason, `cancel:${s.id}`);
    const left = await this.prisma.shipment.count({ where: { orderId: s.orderId, status: { notIn: ['cancelled', 'rejected'] } } });
    if (left === 0) await this.prisma.order.update({ where: { id: s.orderId }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } });
    await this.mail.send({
      to: s.order.recipientEmail,
      subject: `Отправление № ${s.order.number}-${s.no} отменено`,
      text: `Отправление № ${s.order.number}-${s.no} отменено: ${reason}.${s.order.status === 'paid' ? ` Деньги вернутся на карту или счёт СБП, обычно в течение нескольких дней.` : ''}`,
    });
  }

  async refund(s: Shipment & { supplier: Supplier; order: Order }, lines: { item: ShipmentItem; qty: number }[], withDelivery: boolean, reason: string, key: string) {
    if (await this.prisma.refund.findUnique({ where: { idempotenceKey: key } })) return;
    const goods = lines.reduce((sum, l) => sum + l.item.price * l.qty, 0);
    const commission = commissionOfLines(lines.map((l) => ({ price: l.item.price, qty: l.qty, commissionBp: l.item.commissionBp })));
    const amount = goods + (withDelivery ? s.deliveryPrice : 0);
    const res = await this.payments.createRefund({
      idempotenceKey: key,
      paymentId: s.order.paymentId!,
      amount,
      description: `Заказ ${s.order.number}-${s.no}: ${reason}`,
      sources: s.order.settlement === 'split' ? [this.transfer(s, goods, commission, s.order.number)] : [],
      receipt: this.receipt(s.order, [{ ...s, deliveryPrice: withDelivery ? s.deliveryPrice : 0, items: lines.map((l) => ({ ...l.item, qty: l.qty })) }]),
    });
    await this.prisma.$transaction([
      this.prisma.refund.create({ data: { orderId: s.orderId, shipmentId: s.id, amount, goodsAmount: goods, commission, reason, providerRefundId: res.id, idempotenceKey: key, status: res.status } }),
      this.prisma.payout.create({ data: { shipmentId: s.id, supplierId: s.supplierId, kind: 'refund', amountGoods: -goods, commission: -commission, transferred: -(goods - commission), manual: s.order.settlement === 'registry' } }),
    ]);
  }

  /** Отмена заказа покупателем: снимаются неотгруженные отправления. */
  async cancelByBuyer(user: User, number: string) {
    const order = await this.full(user, number);
    if (order.status === 'cancelled') throw new BadRequestException({ message: 'Заказ уже отменён' });
    if (order.status === 'pending_payment') {
      await this.cancelUnpaid(order.id, 'Отменён покупателем');
      return this.view(user, number);
    }
    const cancellable = order.shipments.filter((s) => CANCELLABLE_SHIPMENT.includes(s.status));
    if (!cancellable.length) throw new BadRequestException({ message: 'Все отправления уже переданы в доставку — оформите возврат после получения' });
    for (const s of cancellable) await this.cancelShipment(s.id, 'cancelled', 'Отменён покупателем');
    return this.view(user, number);
  }

  // ─── возвраты товаров ────────────────────────────────────────────────

  async requestReturn(user: User, number: string, shipmentNo: number, input: { items: { itemId: string; qty: number }[]; reason: string }) {
    const order = await this.full(user, number);
    const s = order.shipments.find((x) => x.no === shipmentNo);
    if (!s) throw new NotFoundException();
    if (s.status !== 'delivered' || !s.deliveredAt) throw new BadRequestException({ message: 'Возврат оформляется после получения' });
    if (Date.now() - s.deliveredAt.getTime() > RETURN_DAYS * DAY) throw new BadRequestException({ message: `Возврат возможен в течение ${RETURN_DAYS} дней после получения` });
    if (await this.prisma.returnRequest.findFirst({ where: { shipmentId: s.id, status: 'requested' } })) throw new ConflictException({ message: 'Заявка на возврат уже на рассмотрении' });
    if (new Set(input.items.map((r) => r.itemId)).size !== input.items.length) throw new BadRequestException({ message: 'Каждый товар — одной строкой' });
    let amount = 0;
    for (const r of input.items) {
      const item = s.items.find((i) => i.id === r.itemId);
      if (!item || r.qty > item.qty - item.returnedQty) throw new BadRequestException({ message: 'Неверное количество для возврата' });
      amount += item.price * r.qty;
    }
    // Одна открытая заявка на отправление гарантируется уникальным индексом (гонка двух запросов).
    await this.prisma.returnRequest.create({ data: { shipmentId: s.id, userId: user.id, items: input.items, reason: input.reason, amount } }).catch((e) => {
      if (e?.code === 'P2002') throw new ConflictException({ message: 'Заявка на возврат уже на рассмотрении' });
      throw e;
    });
    await this.prisma.shipmentEvent.create({ data: { shipmentId: s.id, status: 'return_requested', note: `Запрошен возврат на ${formatRub(amount)}` } });
    return this.view(user, number);
  }

  // ─── просмотр ────────────────────────────────────────────────────────

  private async full(user: User, number: string) {
    const order = await this.prisma.order.findFirst({
      where: { number, userId: user.id },
      include: { shipments: { include: { items: true, supplier: true, events: { orderBy: { at: 'asc' } }, returns: { orderBy: { createdAt: 'desc' } } }, orderBy: { no: 'asc' } }, refunds: true },
    });
    if (!order) throw new NotFoundException({ message: 'Заказ не найден' });
    return order;
  }

  async list(user: User) {
    const orders = await this.prisma.order.findMany({ where: { userId: user.id }, include: { shipments: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    return orders.map((o) => ({
      number: o.number,
      createdAt: o.createdAt,
      status: o.status,
      total: o.total,
      shipments: o.shipments.length,
      delivery: [...new Set(o.shipments.map((s) => (s.deliveryType === 'pvz' ? 'ПВЗ СДЭК' : 'Курьер СДЭК')))].join(', '),
      shipmentStatuses: o.shipments.map((s) => s.status),
    }));
  }

  async view(user: User, number: string) {
    const o = await this.full(user, number);
    const eta = o.shipments.filter((s) => !['cancelled', 'rejected'].includes(s.status)).map((s) => s.eta?.getTime() ?? 0);
    return {
      number: o.number,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      expiresAt: o.expiresAt,
      cancelReason: o.cancelReason,
      eta: eta.length ? new Date(Math.max(...eta)) : null,
      goodsTotal: o.goodsTotal,
      deliveryTotal: o.deliveryTotal,
      total: o.total,
      refunded: o.refunds.filter((r) => r.status !== 'canceled').reduce((s, r) => s + r.amount, 0),
      recipient: { name: o.recipientName, phone: o.recipientPhone, email: o.recipientEmail },
      canCancel: o.status === 'pending_payment' || o.shipments.some((s) => CANCELLABLE_SHIPMENT.includes(s.status) && s.status !== 'awaiting_payment'),
      shipments: o.shipments.map((s) => ({
        no: s.no,
        supplier: s.supplier.legalName,
        status: s.status,
        deliveryType: s.deliveryType,
        address: s.address,
        deliveryPrice: s.deliveryPrice,
        periodMin: s.periodMin,
        periodMax: s.periodMax,
        eta: s.eta,
        trackNo: s.trackNo,
        goodsTotal: s.goodsTotal,
        rejectReason: s.rejectReason,
        canReturn: s.status === 'delivered' && !!s.deliveredAt && Date.now() - s.deliveredAt.getTime() <= RETURN_DAYS * DAY && s.items.some((i) => i.qty > i.returnedQty),
        returns: s.returns.map((r) => ({ id: r.id, status: r.status, amount: r.amount, reason: r.reason, rejectReason: r.rejectReason, createdAt: r.createdAt })),
        events: s.events.map((e) => ({ status: e.status, note: e.note, at: e.at })),
        items: s.items.map((i) => ({
          id: i.id, variantId: i.variantId, slug: i.productSlug, title: i.title, brand: i.brand, size: i.size, heightRange: i.heightRange, color: i.color,
          price: i.price, qty: i.qty, returnedQty: i.returnedQty, image: this.storage.publicUrl(i.imageKey),
        })),
      })),
    };
  }

  // ─── фоновые проверки ────────────────────────────────────────────────

  /** Раз в минуту: просроченные неоплаченные заказы и неподтверждённые за 48 ч отправления (ТЗ §6.3, §7.5). */
  async sweep(now = new Date()) {
    const { confirmHours } = await this.settings.get();
    const expired = await this.prisma.order.findMany({ where: { status: 'pending_payment', expiresAt: { lt: now } }, select: { id: true }, take: 100 });
    for (const o of expired) await this.expire(o.id).catch((e) => this.logger.error(`expire ${o.id}: ${e.message}`));
    const stale = await this.prisma.shipment.findMany({
      where: { status: 'new', paidAt: { lt: new Date(now.getTime() - confirmHours * 3600000) } },
      select: { id: true },
      take: 100,
    });
    // За сутки без подтверждения — напоминание поставщику, один раз.
    const overdue = await this.prisma.shipment.findMany({
      where: { status: 'new', overdueNotifiedAt: null, paidAt: { lt: new Date(now.getTime() - 24 * 3600000), gt: new Date(now.getTime() - confirmHours * 3600000) } },
      include: { order: true },
      take: 100,
    });
    for (const s of overdue) {
      await this.prisma.shipment.update({ where: { id: s.id }, data: { overdueNotifiedAt: now } });
      await this.notifications.notify(s.supplierId, 'order_overdue', {
        title: `Заказ № ${s.order.number}-${s.no} ждёт подтверждения больше суток`,
        body: `Если не подтвердить его за ${confirmHours} ч с момента оплаты, заказ отменится и деньги вернутся покупателю.`,
        link: `/supplier/orders/${s.id}`,
      });
    }
    for (const s of stale) {
      await this.cancelShipment(s.id, 'cancelled', `Поставщик не подтвердил заказ за ${confirmHours} ч`).catch((e) => this.logger.error(`autocancel ${s.id}: ${e.message}`));
    }
    return { expired: expired.length, autoCancelled: stale.length, overdue: overdue.length };
  }
}
