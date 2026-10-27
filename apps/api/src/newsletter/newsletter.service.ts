import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatRub, salePriceOf } from '@aesculap/shared';
import type { NewsletterCampaign, Prisma, Promotion, User } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AuditService } from '../common/audit.service';
import { JobsService } from '../common/jobs.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { visibleWhere } from '../storefront/catalog.service';

export const NEWSLETTER_JOB = 'newsletter.promotion';
/** Запуск, который «висит» дольше этого (упал воркер), можно перезапустить */
const STALE_MS = 6 * 3600000;
const date = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/**
 * Ссылка «Отписаться»: подпись HMAC от userId без срока действия (ТЗ §11 — отписка в любой момент).
 * Формат `<uuid>-<32 hex>`; секрет — UNSUBSCRIBE_SECRET.
 */
const sign = (userId: string) => createHmac('sha256', config.newsletter.secret).update(`unsubscribe:marketing:${userId}`).digest('hex').slice(0, 32);
export const unsubscribeToken = (userId: string) => `${userId}-${sign(userId)}`;

export function verifyUnsubscribeToken(token: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{32})$/.exec(token.trim().toLowerCase());
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}

/**
 * Рассылка покупателям по акции (ТЗ §7.7, §11). Получатели — покупатели с действующим отдельным
 * согласием на рассылку, не заблокированные, не удалённые, с подтверждённым email. Отправка — фоновая
 * задача пачками с паузой; строка в newsletter_deliveries гарантирует одно письмо человеку по акции.
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger('Newsletter');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailTemplatesService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  private recipientsWhere(): Prisma.UserWhereInput {
    return {
      role: 'buyer',
      deletedAt: null,
      blockedAt: null,
      emailVerifiedAt: { not: null },
      consents: { some: { type: 'marketing', revokedAt: null } },
    };
  }

  /** Кому письмо ещё не уходило (и не уходит прямо сейчас) — неудачные отправки повторяются при перезапуске */
  private pendingWhere(promotionId: string): Prisma.UserWhereInput {
    return { ...this.recipientsWhere(), newsletterDeliveries: { none: { promotionId, status: { in: ['sent', 'sending'] } } } };
  }

  private campaignView(c: NewsletterCampaign | null) {
    if (!c) return null;
    return { status: c.status, total: c.total, sent: c.sent, failed: c.failed, error: c.error, queuedAt: c.queuedAt, startedAt: c.startedAt, finishedAt: c.finishedAt };
  }

  private async promotion(id: string) {
    const p = await this.prisma.promotion.findUnique({ where: { id }, include: { newsletterCampaign: true } });
    if (!p) throw new NotFoundException({ message: 'Акция не найдена' });
    return p;
  }

  /** Для окна подтверждения в админке: сколько получат письмо сейчас и статус последнего запуска */
  async preview(promotionId: string) {
    const p = await this.promotion(promotionId);
    const [recipients, pending] = await Promise.all([
      this.prisma.user.count({ where: this.recipientsWhere() }),
      this.prisma.user.count({ where: this.pendingWhere(promotionId) }),
    ]);
    return { recipients, pending, campaign: this.campaignView(p.newsletterCampaign) };
  }

  async start(promotionId: string, admin: User) {
    const p = await this.promotion(promotionId);
    if (!p.newsletter) throw new BadRequestException({ message: 'В условиях акции рассылка не включена — отметьте «Рассылка покупателям» в настройках акции' });
    if (p.endsAt <= new Date()) throw new BadRequestException({ message: 'Акция уже завершилась' });

    const [total, sent, pending] = await Promise.all([
      this.prisma.user.count({ where: this.recipientsWhere() }),
      this.prisma.user.count({ where: { ...this.recipientsWhere(), newsletterDeliveries: { some: { promotionId, status: 'sent' } } } }),
      this.prisma.user.count({ where: this.pendingWhere(promotionId) }),
    ]);
    // Захват запуска одним условным UPDATE: два одновременных клика не запустят две рассылки.
    await this.prisma.newsletterCampaign.upsert({ where: { promotionId }, create: { promotionId, status: 'done' }, update: {} });
    const claimed = await this.prisma.newsletterCampaign.updateMany({
      where: { promotionId, OR: [{ status: { in: ['done', 'failed'] } }, { queuedAt: { lt: new Date(Date.now() - STALE_MS) } }] },
      data: { status: 'queued', total, sent, failed: 0, error: null, startedById: admin.id, queuedAt: new Date(), startedAt: null, finishedAt: null },
    });
    if (!claimed.count) throw new ConflictException({ message: 'Рассылка по этой акции уже идёт' });
    await this.audit.log(admin.id, 'promotion.newsletter', 'promotion', promotionId, { recipients: total, pending });
    await this.jobs.enqueue(NEWSLETTER_JOB, { promotionId }, { attempts: 3 });
    return this.preview(promotionId);
  }

  /** Фоновая задача. Повтор после сбоя продолжает с тех, кому письмо ещё не ушло. */
  async run(promotionId: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promo) return;
    try {
      await this.prisma.newsletterCampaign.update({ where: { promotionId }, data: { status: 'running', startedAt: new Date(), error: null } });
      const products = await this.products(promo);
      let cursor: string | undefined;
      for (;;) {
        const batch = await this.prisma.user.findMany({
          where: { AND: [this.pendingWhere(promotionId), cursor ? { id: { gt: cursor } } : {}] },
          select: { id: true, email: true },
          orderBy: { id: 'asc' },
          take: config.newsletter.batch,
        });
        for (const u of batch) await this.deliver(promo, products, u);
        if (batch.length < config.newsletter.batch) break;
        cursor = batch.at(-1)!.id;
        if (config.newsletter.pauseMs > 0) await sleep(config.newsletter.pauseMs);
      }
      await this.prisma.newsletterCampaign.update({ where: { promotionId }, data: { status: 'done', finishedAt: new Date() } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.prisma.newsletterCampaign.update({ where: { promotionId }, data: { status: 'failed', error: message.slice(0, 500), finishedAt: new Date() } }).catch(() => undefined);
      throw e;
    }
  }

  private async deliver(promo: Promotion, products: string[], u: { id: string; email: string }) {
    // Сначала «занять» отправку: новая строка или повтор неудачной. Иначе письмо уже ушло или уходит.
    const created = await this.prisma.newsletterDelivery.createMany({ data: [{ promotionId: promo.id, userId: u.id }], skipDuplicates: true });
    const claimed = created.count || (await this.prisma.newsletterDelivery.updateMany({ where: { promotionId: promo.id, userId: u.id, status: 'failed' }, data: { status: 'sending', error: null } })).count;
    if (!claimed) return;
    try {
      const l = this.letter(promo, products, u);
      await this.mail.send('newsletter.promotion', u.email, l.vars, { headers: l.headers });
      await this.prisma.newsletterDelivery.update({ where: { promotionId_userId: { promotionId: promo.id, userId: u.id } }, data: { status: 'sent', sentAt: new Date() } });
      await this.prisma.newsletterCampaign.update({ where: { promotionId: promo.id }, data: { sent: { increment: 1 } } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Письмо по акции ${promo.id} → ${u.id}: ${message}`);
      await this.prisma.newsletterDelivery.update({ where: { promotionId_userId: { promotionId: promo.id, userId: u.id } }, data: { status: 'failed', error: message.slice(0, 500) } });
      await this.prisma.newsletterCampaign.update({ where: { promotionId: promo.id }, data: { failed: { increment: 1 } } });
    }
  }

  /** До 6 одобренных товаров акции, видимых на витрине, — строки письма с ценой */
  private async products(promo: Promotion) {
    const rows = await this.prisma.promotionProduct.findMany({
      where: { promotionId: promo.id, status: 'approved', discountPct: { gte: promo.minDiscountPct }, product: visibleWhere() },
      include: { product: { select: { title: true, slug: true, variants: { where: { stock: { gt: 0 } }, select: { price: true } } } } },
      orderBy: { discountPct: 'desc' },
      take: 6,
    });
    return rows.map((r) => {
      const price = Math.min(...r.product.variants.map((v) => v.price));
      return `• ${r.product.title} — ${formatRub(salePriceOf(price, r.discountPct))} вместо ${formatRub(price)} (−${r.discountPct}%)\n  ${config.webOrigin}/product/${r.product.slug}`;
    });
  }

  private letter(promo: Promotion, products: string[], u: { id: string; email: string }) {
    const unsubscribe = `${config.webOrigin}/unsubscribe?token=${unsubscribeToken(u.id)}`;
    const started = promo.startsAt <= new Date();
    const when = started ? `Акция идёт до ${date(promo.endsAt)}` : `Акция пройдёт с ${date(promo.startsAt)} по ${date(promo.endsAt)}`;
    return {
      // Текст письма — шаблон newsletter.promotion (админка «Шаблоны писем»); условные куски приходят готовыми строками
      vars: {
        'promotion.name': promo.name,
        when,
        minDiscount: promo.minDiscountPct,
        description: promo.description,
        products: products.length ? ['Товары по акции:', ...products].join('\n') : '',
        catalogLine: `${started ? 'Все товары по акции' : `Товары по акции появятся в каталоге ${date(promo.startsAt)}`}: ${config.webOrigin}/catalog?sale=1`,
        unsubscribeUrl: unsubscribe,
        profileUrl: `${config.webOrigin}/account`,
      },
      // RFC 2369 / RFC 8058: кнопка «Отписаться» в почтовом клиенте, one-click POST без перехода на сайт
      headers: {
        'List-Unsubscribe': `<${config.webOrigin}/api/newsletter/unsubscribe?token=${unsubscribeToken(u.id)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  /** Отписка по ссылке из письма: отзывает согласие на рассылку (ставит revokedAt), как и переключатель в профиле */
  async unsubscribe(token: string, ip: string) {
    const userId = verifyUnsubscribeToken(token);
    if (!userId) throw new BadRequestException({ message: 'Ссылка отписки недействительна или повреждена.' });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, deletedAt: true } });
    if (!user) throw new BadRequestException({ message: 'Ссылка отписки недействительна или повреждена.' });
    const r = await this.prisma.consent.updateMany({ where: { userId, type: 'marketing', revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count) await this.audit.log(userId, 'consent.revoke', 'user', userId, { type: 'marketing', via: 'unsubscribe', ip });
    return { ok: true, alreadyRevoked: r.count === 0, email: user.deletedAt ? null : maskEmail(user.email) };
  }
}

/** n***@example.ru — чтобы на странице было понятно, какой адрес отписан, не раскрывая его целиком */
function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}
