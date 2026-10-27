import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatRub, type PremiumOrderInput } from '@aesculap/shared';
import type { PremiumLead, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { newToken } from '../common/crypto';
import { LegalService } from '../common/legal.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { CartService } from '../orders/cart.service';
import { OrdersService } from '../orders/orders.service';

/** Ссылка на оплату уходит письмом — покупателю нужно больше 30 минут; резерв держится сутки */
export const PREMIUM_PAY_HOURS = 24;

type SnapshotItem = { slot: string; slotLabel: string; variantId: string; title: string; brand: string; color: string; size: string; price: number };

const msk = (d: Date) => d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });

/**
 * «Создать заказ» из премиум-заявки (ТЗ §8): менеджер подтверждает получателя, доставку по отправлениям и состав
 * из снимка капсулы (цены и наличие — на сейчас), создаётся обычный заказ через OrdersService.create — с резервом,
 * сплитом и чеком, но без корзины. Покупателю — письмо со ссылкой на оплату; заявка — «в работе» со ссылкой на заказ.
 */
@Injectable()
export class PremiumOrderService {
  private readonly logger = new Logger('PremiumOrder');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly cart: CartService,
    private readonly auth: AuthService,
    private readonly legal: LegalService,
    private readonly audit: AuditService,
    private readonly mail: MailTemplatesService,
  ) {}

  private async lead(id: string) {
    const l = await this.prisma.premiumLead.findUnique({ where: { id }, include: { user: true, order: true } });
    if (!l) throw new NotFoundException({ message: 'Заявка не найдена' });
    return l;
  }

  private items(l: PremiumLead) {
    return ((l.capsule as { items?: SnapshotItem[] }).items ?? []).filter((i) => i.variantId);
  }

  /** Активный заказ по заявке (отменённый не мешает создать новый) */
  private activeOrder<O extends { status: string }>(l: { order: O | null }): O | null {
    return l.order && l.order.status !== 'cancelled' ? l.order : null;
  }

  /** Черновик заказа: получатель из заявки, состав капсулы с ценой и наличием на сейчас, поставщики для доставки */
  async draft(id: string) {
    const l = await this.lead(id);
    const snapshot = this.items(l);
    const checked = await this.cart.check(snapshot.map((i) => ({ variantId: i.variantId, qty: 1, fromCapsule: true })));
    const items = snapshot.map((i) => {
      const c = checked.find((x) => x.variantId === i.variantId);
      return {
        slotLabel: i.slotLabel, variantId: i.variantId, title: i.title, brand: i.brand, color: i.color, size: i.size,
        snapshotPrice: i.price, price: c?.price ?? null, available: Boolean(c?.available), stock: c?.stock ?? 0,
        supplier: c ? { id: c.supplier.id, name: c.supplier.name, city: c.supplier.city } : null,
      };
    });
    const user = l.user && !l.user.deletedAt ? l.user : null;
    return {
      recipient: { name: l.name, phone: l.phone, email: user?.email ?? '' },
      account: user ? { email: user.email } : null,
      items,
      payHours: PREMIUM_PAY_HOURS,
      order: this.activeOrder(l) ? { number: l.order!.number, status: l.order!.status } : null,
    };
  }

  /** Тарифы СДЭК по отправлениям для выбранного города — как в оформлении */
  async quote(id: string, cityCode: number, variantIds: string[]) {
    const l = await this.lead(id);
    const allowed = new Set(this.items(l).map((i) => i.variantId));
    const lines = variantIds.filter((v) => allowed.has(v)).map((variantId) => ({ variantId, qty: 1 }));
    if (!lines.length) throw new BadRequestException({ message: 'Выберите вещи из капсулы' });
    return this.orders.quote(lines, cityCode);
  }

  /**
   * Покупатель заказа: у заявки есть аккаунт — он; иначе находим покупателя по email или создаём без пароля
   * (согласие на обработку ПДн дано в форме заявки — пишем его с IP заявки) и шлём письмо «задайте пароль».
   */
  private async customer(l: PremiumLead & { user: User | null }, email: string, phone: string) {
    if (l.user && !l.user.deletedAt) {
      if (l.user.blockedAt) throw new BadRequestException({ message: 'Аккаунт покупателя заблокирован' });
      return { user: l.user, created: false };
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.deletedAt || existing.blockedAt) throw new BadRequestException({ message: 'Аккаунт с этим email удалён или заблокирован', errors: { email: 'Недоступен' } });
      if (existing.role !== 'buyer') throw new ConflictException({ message: 'Этот email у сотрудника или поставщика — укажите личный email покупателя', errors: { email: 'Не покупатель' } });
      return { user: existing, created: false };
    }
    const user = await this.prisma.user.create({
      data: {
        email, phone, passwordHash: await argon2.hash(newToken()),
        consents: { create: [{ type: 'pdn', version: await this.legal.consentVersion('pdn'), ip: l.ip }] },
      },
    });
    return { user, created: true };
  }

  async create(id: string, input: PremiumOrderInput, staff: User) {
    const l = await this.lead(id);
    if (this.activeOrder(l)) throw new ConflictException({ message: `По заявке уже создан заказ № ${l.order!.number}` });
    if (l.status === 'cancelled' || l.status === 'done') throw new BadRequestException({ message: 'Заявка закрыта — сначала верните её в работу' });
    const snapshot = this.items(l);
    const allowed = new Set(snapshot.map((i) => i.variantId));
    const ids = [...new Set(input.variantIds)];
    if (ids.some((v) => !allowed.has(v))) throw new BadRequestException({ message: 'В заказ можно добавить только вещи из капсулы заявки' });

    const { user, created } = await this.customer(l, input.recipient.email, input.recipient.phone);
    let order: Awaited<ReturnType<OrdersService['create']>>;
    try {
      order = await this.orders.create(
        user,
        ids.map((variantId) => ({ variantId, qty: 1, fromCapsule: true })),
        { recipient: input.recipient, delivery: input.delivery, saveAddresses: false },
        { keepCart: true, payMinutes: PREMIUM_PAY_HOURS * 60 },
      );
    } catch (e) {
      // Заказ не создался (наличие, доставка) — только что созданный аккаунт без заказа не оставляем
      if (created) await this.prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      throw e;
    }
    // Заявку занимает первый успешный заказ; параллельный второй отменяется с возвратом резерва
    const claimed = await this.prisma.premiumLead.updateMany({ where: { id, OR: [{ orderId: null }, { orderId: l.orderId }] }, data: { orderId: order.id, status: 'in_progress' } });
    if (!claimed.count) {
      await this.orders.cancelUnpaid(order.id, 'Дубль заказа по премиум-заявке');
      throw new ConflictException({ message: 'По заявке уже создан заказ — обновите страницу' });
    }
    await this.audit.log(staff.id, 'premium.lead.order', 'premium_lead', id, { orderNumber: order.number, userId: user.id, newAccount: created, items: ids.length });
    await this.sendLink(order.number, order.confirmationUrl);
    if (created) await this.auth.sendAccountSetup(user, input.recipient.name, order.number).catch((e: Error) => this.logger.warn(`Письмо «задайте пароль» ${user.id}: ${e.message}`));
    return { number: order.number, confirmationUrl: order.confirmationUrl, newAccount: created };
  }

  /** Повторная ссылка на оплату: платёж мог истечь в платёжке раньше резерва */
  async resend(id: string, staff: User) {
    const l = await this.lead(id);
    const o = this.activeOrder(l);
    if (!o) throw new BadRequestException({ message: 'По заявке нет заказа' });
    if (o.status !== 'pending_payment') throw new BadRequestException({ message: 'Заказ уже оплачен' });
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: l.order!.userId } });
    const r = await this.orders.retryPayment(owner, o.number);
    if (!r.confirmationUrl) return { ok: true, paid: true };
    await this.sendLink(o.number, r.confirmationUrl);
    await this.audit.log(staff.id, 'premium.lead.order_link', 'premium_lead', id, { orderNumber: o.number });
    return { ok: true, paid: false };
  }

  private async sendLink(number: string, paymentUrl: string | null) {
    if (!paymentUrl) return;
    const o = await this.prisma.order.findUniqueOrThrow({ where: { number }, include: { shipments: { include: { items: true }, orderBy: { no: 'asc' } } } });
    await this.mail
      .send('order.payment_link', o.recipientEmail, {
        name: o.recipientName,
        'order.number': o.number,
        'order.total': formatRub(o.total),
        items: o.shipments.flatMap((s) => s.items.map((i) => `• ${i.title}, ${i.color}, ${i.size} — ${formatRub(i.price * i.qty)}`)).join('\n'),
        delivery: o.shipments
          .map((s) => `• Отправление ${s.no}: ${s.deliveryType === 'pvz' ? 'пункт выдачи СДЭК' : 'курьер СДЭК'}, ${s.address} — ${formatRub(s.deliveryPrice)}`)
          .join('\n'),
        paymentUrl: paymentUrl.startsWith('/') ? `${config.webOrigin}${paymentUrl}` : paymentUrl,
        payUntil: msk(o.expiresAt),
        orderUrl: `${config.webOrigin}/account/orders/${o.number}`,
      })
      .catch((e: Error) => this.logger.error(`Ссылка на оплату ${number}: ${e.message}`));
  }
}

