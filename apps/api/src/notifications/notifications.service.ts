import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { NOTIFY_EVENTS, type NotifyEvent } from '@aesculap/shared';
import type { SupplierMemberRole, User } from '@prisma/client';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { config } from '../config';
import { TelegramService } from './telegram.service';

/** Кому из сотрудников поставщика интересно событие */
const ROLES: Record<NotifyEvent, SupplierMemberRole[]> = {
  order_paid: ['owner', 'warehouse'],
  order_overdue: ['owner', 'warehouse'],
  capsule_zero_stock: ['owner', 'catalog', 'warehouse'],
  moderation: ['owner', 'catalog'],
  import_report: ['owner', 'catalog'],
  promotion: ['owner', 'catalog'],
  review: ['owner', 'catalog'],
};

export type NotifyPayload = { title: string; body?: string; link?: string };

/**
 * Уведомления поставщику (ТЗ §7.9): запись в центр уведомлений всегда, email и Telegram —
 * по настройкам сотрудника. Ошибка канала не ломает бизнес-операцию.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notify');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailTemplatesService,
    readonly telegram: TelegramService,
    private readonly limits: RateLimitService,
  ) {}

  async notify(supplierId: string, event: NotifyEvent, p: NotifyPayload) {
    try {
      const members = await this.prisma.supplierMember.findMany({
        where: { supplierId, role: { in: ROLES[event] } },
        include: { user: { include: { notificationSettings: { where: { supplierId } } } } },
      });
      for (const m of members) {
        if (m.user.deletedAt) continue;
        await this.prisma.notification.create({ data: { userId: m.userId, supplierId, event, title: p.title, body: p.body ?? '', link: p.link } });
        const st = m.user.notificationSettings[0];
        if (st?.mutedEvents.includes(event)) continue;
        const url = p.link ? `${config.webOrigin}${p.link}` : '';
        if (st?.email ?? true) {
          await this.mail.send('supplier.notification', m.user.email, { title: p.title, body: p.body, link: url }).catch((e) => this.logger.warn(`email: ${e.message}`));
        }
        if (st?.telegramChatId) await this.telegram.send(st.telegramChatId, [p.title, p.body, url].filter(Boolean).join('\n'));
      }
    } catch (e) {
      this.logger.error(`notify ${event}: ${(e as Error).message}`);
    }
  }

  // ─── центр уведомлений ───────────────────────────────────────────────

  async list(user: User, supplierId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId: user.id, supplierId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId: user.id, supplierId, readAt: null } }),
    ]);
    return { unread, items: items.map((n) => ({ id: n.id, event: n.event, title: n.title, body: n.body, link: n.link, read: Boolean(n.readAt), createdAt: n.createdAt })) };
  }

  async markRead(user: User, supplierId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, supplierId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return this.list(user, supplierId);
  }

  // ─── настройки ───────────────────────────────────────────────────────

  async settings(user: User, supplierId: string) {
    const st = await this.prisma.notificationSetting.findUnique({ where: { userId_supplierId: { userId: user.id, supplierId } } });
    return {
      email: st?.email ?? true,
      telegramLinked: Boolean(st?.telegramChatId),
      telegramBot: config.telegram.username || null,
      telegramEnabled: this.telegram.enabled,
      mutedEvents: st?.mutedEvents ?? [],
      events: Object.entries(NOTIFY_EVENTS).map(([id, label]) => ({ id, label })),
    };
  }

  async saveSettings(user: User, supplierId: string, input: { email: boolean; mutedEvents: string[] }) {
    await this.prisma.notificationSetting.upsert({
      where: { userId_supplierId: { userId: user.id, supplierId } },
      update: { email: input.email, mutedEvents: input.mutedEvents },
      create: { userId: user.id, supplierId, email: input.email, mutedEvents: input.mutedEvents },
    });
    return this.settings(user, supplierId);
  }

  async linkTelegram(user: User, supplierId: string, code: string) {
    // Код из 6 цифр: без лимита его можно подобрать и привязать чужой чат
    await this.limits.hit('tg-link', user.id, 5, 900);
    const chatId = await this.telegram.redeem(code);
    if (!chatId) throw new BadRequestException({ message: 'Код не найден или устарел — напишите боту /start ещё раз', errors: { code: 'Неверный код' } });
    await this.prisma.notificationSetting.upsert({
      where: { userId_supplierId: { userId: user.id, supplierId } },
      update: { telegramChatId: chatId },
      create: { userId: user.id, supplierId, telegramChatId: chatId },
    });
    await this.telegram.send(chatId, `Готово: уведомления кабинета поставщика ${config.brandName} будут приходить сюда.`);
    return this.settings(user, supplierId);
  }

  async unlinkTelegram(user: User, supplierId: string) {
    await this.prisma.notificationSetting.updateMany({ where: { userId: user.id, supplierId }, data: { telegramChatId: null } });
    return this.settings(user, supplierId);
  }
}
