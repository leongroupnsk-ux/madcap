import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { User } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { JobsService } from '../common/jobs.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

export const REVIEW_INVITE_JOB = 'reviews.invite';
const DAY = 86400000;
/** Через сколько дней после доставки просим отзыв */
export const REVIEW_INVITE_DAYS = 7;
/** Старше — не пишем (при первом запуске не рассылаем приглашения по давно доставленным заказам) */
const REVIEW_INVITE_MAX_DAYS = 30;

/** Ссылка отписки: HMAC от userId без срока действия (как у рассылки), секрет — UNSUBSCRIBE_SECRET */
const sign = (userId: string) => createHmac('sha256', config.newsletter.secret).update(`unsubscribe:review:${userId}`).digest('hex').slice(0, 32);
export const reviewInviteToken = (userId: string) => `${userId}-${sign(userId)}`;

export function verifyReviewInviteToken(token: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{32})$/.exec(token.trim().toLowerCase());
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
};

/**
 * Письмо «Оставьте отзыв» через 7 дней после доставки отправления (ТЗ §6.6, E9-01). Раз в час фоновая задача
 * берёт доставленные 7–30 дней назад отправления без отметки reviewInviteAt, ставит отметку (одно письмо на
 * отправление, даже если письмо решено не слать) и пишет покупателю, если:
 *  - аккаунт не удалён и не заблокирован, это покупатель;
 *  - согласие на обработку ПДн действует;
 *  - покупатель не отписался от таких писем (users.reviewInvitesOffAt — профиль или ссылка в письме);
 *  - в отправлении есть товары, возвращённые не целиком и ещё без отзыва этого покупателя.
 * Отписка — свой флаг, а не согласие marketing: приглашение к отзыву — сервисное письмо о сделанной покупке, не реклама;
 * покупатель без согласия на рассылку его получает, а отказ от отзывов не отписывает от акций (и наоборот).
 */
@Injectable()
export class ReviewInvitesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ReviewInvites');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailTemplatesService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    this.jobs.register(REVIEW_INVITE_JOB, () => this.run().then(() => undefined));
    await this.jobs.repeat(REVIEW_INVITE_JOB, 3600_000);
  }

  async run(now = new Date()) {
    const due = await this.prisma.shipment.findMany({
      where: { status: 'delivered', reviewInviteAt: null, deliveredAt: { lte: new Date(now.getTime() - REVIEW_INVITE_DAYS * DAY), gte: new Date(now.getTime() - REVIEW_INVITE_MAX_DAYS * DAY) } },
      select: { id: true },
      orderBy: { deliveredAt: 'asc' },
      take: 500,
    });
    let sent = 0;
    let skipped = 0;
    for (const { id } of due) {
      // Сначала «занять» отправление — параллельная задача не пришлёт второе письмо
      const claimed = await this.prisma.shipment.updateMany({ where: { id, reviewInviteAt: null }, data: { reviewInviteAt: now } });
      if (!claimed.count) continue;
      try {
        if (await this.invite(id)) sent++;
        else skipped++;
      } catch (e) {
        // Письмо не ушло — снимаем отметку, следующий запуск повторит
        await this.prisma.shipment.update({ where: { id }, data: { reviewInviteAt: null } });
        this.logger.warn(`Приглашение к отзыву ${id}: ${(e as Error).message}`);
      }
    }
    if (sent || skipped) this.logger.log(`Приглашения к отзыву: отправлено ${sent}, пропущено ${skipped}`);
    return { sent, skipped };
  }

  /** true — письмо ушло; false — по правилам писать не нужно */
  private async invite(shipmentId: string) {
    const s = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: {
        items: { include: { variant: { select: { productId: true } } } },
        order: { include: { user: { include: { consents: { where: { type: 'pdn', revokedAt: null } }, buyerProfile: { select: { name: true } } } } } },
      },
    });
    const u = s.order.user;
    if (u.deletedAt || u.blockedAt || u.role !== 'buyer' || u.reviewInvitesOffAt || !u.consents.length) return false;
    const reviewed = new Set((await this.prisma.review.findMany({ where: { userId: u.id }, select: { productId: true } })).map((r) => r.productId));
    const items = s.items.filter((i) => i.qty > i.returnedQty && !(i.variant && reviewed.has(i.variant.productId)));
    if (!items.length) return false;
    await this.mail.send(
      'review.invite',
      u.email,
      {
        name: u.buyerProfile?.name?.trim().split(/\s+/)[0] || 'покупатель',
        'order.number': s.order.number,
        products: items.map((i) => `• ${i.title}, ${i.size}`).join('\n'),
        orderUrl: `${config.webOrigin}/account/orders/${s.order.number}#reviews`,
        unsubscribeUrl: `${config.webOrigin}/review-invites/unsubscribe?token=${reviewInviteToken(u.id)}`,
      },
      { headers: { 'List-Unsubscribe': `<${config.webOrigin}/api/review-invites/unsubscribe?token=${reviewInviteToken(u.id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } },
    );
    return true;
  }

  // ─── отписка и настройка в профиле ───────────────────────────────────

  settings(user: User) {
    return { enabled: !user.reviewInvitesOffAt };
  }

  async setEnabled(user: User, enabled: boolean) {
    const r = await this.prisma.user.updateMany({ where: { id: user.id, reviewInvitesOffAt: enabled ? { not: null } : null }, data: { reviewInvitesOffAt: enabled ? null : new Date() } });
    if (r.count) await this.audit.log(user.id, enabled ? 'review_invites.on' : 'review_invites.off', 'user', user.id, { via: 'profile' });
    return { enabled };
  }

  async unsubscribe(token: string, ip: string) {
    const userId = verifyReviewInviteToken(token);
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, deletedAt: true } }) : null;
    if (!user) throw new BadRequestException({ message: 'Ссылка отписки недействительна или повреждена.' });
    const r = await this.prisma.user.updateMany({ where: { id: user.id, reviewInvitesOffAt: null }, data: { reviewInvitesOffAt: new Date() } });
    if (r.count) await this.audit.log(user.id, 'review_invites.off', 'user', user.id, { via: 'unsubscribe', ip });
    return { ok: true, alreadyOff: r.count === 0, email: user.deletedAt ? null : maskEmail(user.email) };
  }
}
