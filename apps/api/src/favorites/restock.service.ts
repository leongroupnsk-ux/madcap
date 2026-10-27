import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { JobsService } from '../common/jobs.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { visibleWhere } from '../storefront/catalog.service';

export const RESTOCK_JOB = 'restock.notify';
const RESTOCK_SWEEP = 'restock.sweep';

/**
 * Ссылка «Отписаться» из писем о поступлении: подпись HMAC от id подписки (секрет — UNSUBSCRIBE_SECRET, как у рассылки).
 * Формат `<uuid>-<32 hex>`. Отписка закрывает все открытые подписки того же email.
 */
const sign = (id: string) => createHmac('sha256', config.newsletter.secret).update(`unsubscribe:restock:${id}`).digest('hex').slice(0, 32);
export const restockToken = (id: string) => `${id}-${sign(id)}`;

export function verifyRestockToken(token: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{32})$/.exec(token.trim().toLowerCase());
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}

const variantLabel = (v: { size: string; heightRange: string | null; color: { name: string } }) => [v.color.name.toLowerCase(), `размер ${v.size}`, v.heightRange && `рост ${v.heightRange}`].filter(Boolean).join(', ');
const OPEN = { notifiedAt: null, cancelledAt: null } satisfies Prisma.RestockSubscriptionWhereInput;

/**
 * «Сообщить о поступлении» (подписка на вариант без остатка). Когда остаток варианта снова больше нуля —
 * после правки в кабинете поставщика, импорта или фида, отмены заказа с возвратом резерва — фоновая задача шлёт
 * письмо со ссылкой на товар и закрывает подписку. Раз в 15 минут — проверка всех открытых подписок
 * (на случай изменения остатка в обход этих путей).
 */
@Injectable()
export class RestockService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Restock');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailTemplatesService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    this.jobs.register(RESTOCK_JOB, (data: { variantIds?: string[]; supplierId?: string }) => this.run(data).then(() => undefined));
    this.jobs.register(RESTOCK_SWEEP, () => this.run({}).then(() => undefined));
    await this.jobs.repeat(RESTOCK_SWEEP, 15 * 60_000);
  }

  // ─── подписка ────────────────────────────────────────────────────────

  async subscribe(input: { variantId: string; email?: string; consent?: boolean }, user: User | null, ip: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: input.variantId, product: { moderationStatus: 'published' } },
      include: { color: true, product: { select: { title: true, slug: true } } },
    });
    if (!variant) throw new NotFoundException({ message: 'Товар не найден' });
    if (variant.stock > 0) throw new BadRequestException({ message: 'Этот вариант есть в наличии — его можно положить в корзину' });
    let email: string;
    if (user) email = user.email.toLowerCase();
    else {
      if (!input.email) throw new BadRequestException({ message: 'Укажите email', errors: { email: 'Укажите email' } });
      if (input.consent !== true) throw new BadRequestException({ message: 'Нужно согласие на обработку email', errors: { consent: 'Нужно согласие на обработку email' } });
      email = input.email.toLowerCase();
    }
    const now = new Date();
    const sub = await this.prisma.restockSubscription.upsert({
      where: { variantId_email: { variantId: variant.id, email } },
      create: { variantId: variant.id, email, userId: user?.id ?? null, ip, consentAt: now },
      // Закрытая (письмо ушло или отписка) подписка открывается снова
      update: { notifiedAt: null, cancelledAt: null, userId: user?.id ?? undefined, ip, consentAt: now },
    });
    // Гостю — подтверждение со ссылкой отписки: если email ввёл кто-то другой, владелец адреса отпишется в один клик
    if (!user) {
      await this.mail
        .send('restock.confirm', email, {
          'product.title': variant.product.title,
          variant: variantLabel(variant),
          productUrl: `${config.webOrigin}/product/${variant.product.slug}`,
          unsubscribeUrl: `${config.webOrigin}/restock/unsubscribe?token=${restockToken(sub.id)}`,
        })
        .catch((e: Error) => this.logger.warn(`Подтверждение подписки ${sub.id}: ${e.message}`));
    }
    return { ok: true, email: user ? email : maskEmail(email) };
  }

  /** Открытые подписки вошедшего покупателя — для раздела «Избранное» */
  async mine(user: User) {
    const rows = await this.prisma.restockSubscription.findMany({
      where: { ...OPEN, OR: [{ userId: user.id }, { email: user.email.toLowerCase() }] },
      include: { variant: { include: { color: true, product: { select: { title: true, slug: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => ({ id: s.id, variantId: s.variantId, product: s.variant.product, variant: variantLabel(s.variant), createdAt: s.createdAt }));
  }

  /** Подписки вошедшего на варианты товара — чтобы кнопка показала «Подписка оформлена» */
  async forProduct(user: User, productId: string) {
    const rows = await this.prisma.restockSubscription.findMany({
      where: { ...OPEN, variant: { productId }, OR: [{ userId: user.id }, { email: user.email.toLowerCase() }] },
      select: { variantId: true },
    });
    return rows.map((r) => r.variantId);
  }

  async cancelMine(user: User, id: string) {
    await this.prisma.restockSubscription.updateMany({ where: { id, ...OPEN, OR: [{ userId: user.id }, { email: user.email.toLowerCase() }] }, data: { cancelledAt: new Date() } });
    return this.mine(user);
  }

  /** Отписка по ссылке из письма: закрывает все открытые подписки этого email */
  async unsubscribe(token: string, ip: string) {
    const id = verifyRestockToken(token);
    const sub = id ? await this.prisma.restockSubscription.findUnique({ where: { id } }) : null;
    if (!sub) throw new BadRequestException({ message: 'Ссылка отписки недействительна или повреждена.' });
    const r = await this.prisma.restockSubscription.updateMany({ where: { email: sub.email, ...OPEN }, data: { cancelledAt: new Date() } });
    await this.audit.log(sub.userId, 'restock.unsubscribe', 'restock_subscription', sub.id, { cancelled: r.count, ip });
    return { ok: true, cancelled: r.count, email: maskEmail(sub.email) };
  }

  // ─── пополнение остатка ──────────────────────────────────────────────

  /**
   * Вызывается после изменения остатков (кабинет, импорт, отмена заказа). Задача ставится, только если на эти
   * варианты есть открытые подписки, — обычное сохранение товара очередь не трогает.
   */
  async check(scope: { variantIds?: (string | null)[]; supplierId?: string }) {
    const variantIds = scope.variantIds ? [...new Set(scope.variantIds.filter((x): x is string => Boolean(x)))] : undefined;
    if (variantIds && !variantIds.length) return;
    const where = this.dueWhere(variantIds, scope.supplierId);
    if (!(await this.prisma.restockSubscription.count({ where }))) return;
    await this.jobs.enqueue(RESTOCK_JOB, { variantIds, supplierId: scope.supplierId }, { attempts: 3 });
  }

  /** Открытые подписки на варианты, которые снова в наличии и видны на витрине */
  private dueWhere(variantIds?: string[], supplierId?: string): Prisma.RestockSubscriptionWhereInput {
    return {
      ...OPEN,
      variant: {
        stock: { gt: 0 },
        ...(variantIds ? { id: { in: variantIds } } : {}),
        product: { AND: [visibleWhere(), supplierId ? { supplierId } : {}] },
      },
    };
  }

  /** Фоновая задача: письмо каждому подписчику и закрытие подписки. Повтор после сбоя дошлёт оставшимся. */
  async run(scope: { variantIds?: string[]; supplierId?: string }) {
    const due = await this.prisma.restockSubscription.findMany({
      where: this.dueWhere(scope.variantIds, scope.supplierId),
      include: { variant: { include: { color: true, product: { select: { title: true, slug: true } } } } },
      take: 1000,
    });
    let sent = 0;
    for (const s of due) {
      // Сначала «занять» подписку — параллельная задача не пришлёт второе письмо
      const claimed = await this.prisma.restockSubscription.updateMany({ where: { id: s.id, ...OPEN }, data: { notifiedAt: new Date() } });
      if (!claimed.count) continue;
      const url = `${config.webOrigin}/product/${s.variant.product.slug}`;
      try {
        await this.mail.send(
          'restock.available',
          s.email,
          { 'product.title': s.variant.product.title, variant: variantLabel(s.variant), productUrl: url, unsubscribeUrl: `${config.webOrigin}/restock/unsubscribe?token=${restockToken(s.id)}` },
          {
            headers: { 'List-Unsubscribe': `<${config.webOrigin}/api/restock/unsubscribe?token=${restockToken(s.id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          },
        );
        sent++;
      } catch (e) {
        // Письмо не ушло — подписка снова открыта, следующая проверка повторит
        await this.prisma.restockSubscription.update({ where: { id: s.id }, data: { notifiedAt: null } });
        this.logger.warn(`Письмо о поступлении ${s.id}: ${(e as Error).message}`);
      }
    }
    if (sent) this.logger.log(`Письма о поступлении: ${sent}`);
    return { sent };
  }
}

/** n***@example.ru — понятно, какой адрес подписан, не раскрывая его целиком */
export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}
