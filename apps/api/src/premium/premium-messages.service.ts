import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PREMIUM_TELEGRAM_LINK_DAYS, premiumLeadNo, type PremiumMessageInput } from '@aesculap/shared';
import type { PremiumLead, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { sha256 } from '../common/crypto';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { config } from '../config';
import { TelegramService, type TgMessage } from '../notifications/telegram.service';

/** Префикс параметра /start для заявок: отличает привязку заявки от привязки поставщика (голый /start) */
export const LEAD_START_PREFIX = 'lead_';
const DAY = 86400000;
const MAX_TEXT = 4000;

/**
 * Переписка по премиум-заявке. Telegram — через бота платформы: клиент открывает ссылку
 * t.me/<бот>?start=lead_<код> (код одноразовый, 7 дней), бот привязывает chat_id к заявке; дальше
 * текстовые сообщения клиента пишутся в ленту заявки, ответы менеджера уходят через sendMessage.
 * WhatsApp — без официального API (нужен договор с Meta Business): менеджер пишет со своего телефона
 * по ссылке wa.me и вручную добавляет в ленту заметку со статусом «вне системы».
 */
@Injectable()
export class PremiumMessagesService implements OnModuleInit {
  private readonly logger = new Logger('PremiumMessages');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tg: TelegramService,
    private readonly mail: MailTemplatesService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  onModuleInit() {
    this.tg.registerHandler({
      startPrefix: LEAD_START_PREFIX,
      start: (chatId, code, m) => this.link(chatId, code, m),
      message: (chatId, m) => this.incoming(chatId, m),
    });
  }

  /** Telegram доступен покупателю: бот включён и известно его имя для ссылки */
  get telegramAvailable() {
    return this.tg.startLink('x') !== null;
  }

  /** Новая одноразовая ссылка привязки; прежний неиспользованный код перестаёт действовать */
  async issueLink(leadId: string): Promise<{ url: string; expiresAt: Date } | null> {
    if (!this.telegramAvailable) return null;
    // 18 байт → 24 символа base64url: вместе с префиксом укладывается в лимит /start (64 символа, [A-Za-z0-9_-])
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + PREMIUM_TELEGRAM_LINK_DAYS * DAY);
    await this.prisma.premiumLead.update({ where: { id: leadId }, data: { telegramCodeHash: sha256(code), telegramCodeExpiresAt: expiresAt } });
    return { url: this.tg.startLink(`${LEAD_START_PREFIX}${code}`)!, expiresAt };
  }

  // ─── бот ─────────────────────────────────────────────────────────────

  /** /start lead_<код>: привязка чата к заявке. Код одноразовый — занимаем его условным update. */
  async link(chatId: string, code: string, m: TgMessage) {
    if (m.chat.type && m.chat.type !== 'private') {
      await this.tg.send(chatId, 'Привязать заявку можно только в личном чате с ботом.');
      return;
    }
    const bad = () => this.tg.send(chatId, `Ссылка устарела или уже использована. Если вы оставляли заявку на премиум-капсулу ${config.brandName}, менеджер свяжется с вами по телефону или пришлёт новую ссылку.`);
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(code)) return bad();
    const hash = sha256(code);
    const lead = await this.prisma.premiumLead.findUnique({ where: { telegramCodeHash: hash } });
    if (!lead || !lead.telegramCodeExpiresAt || lead.telegramCodeExpiresAt <= new Date()) return bad();
    const claimed = await this.prisma.premiumLead.updateMany({
      where: { id: lead.id, telegramCodeHash: hash, telegramCodeExpiresAt: { gt: new Date() } },
      data: { telegramChatId: chatId, telegramLinkedAt: new Date(), telegramCodeHash: null, telegramCodeExpiresAt: null },
    });
    if (!claimed.count) return bad();
    await this.audit.log(lead.userId, 'premium.lead.telegram_link', 'premium_lead', lead.id, { relinked: Boolean(lead.telegramChatId && lead.telegramChatId !== chatId) });
    await this.tg.send(
      chatId,
      `Здравствуйте, ${lead.name}! Это ${config.brandName}. Заявка ${premiumLeadNo(lead.no)} на премиум-капсулу привязана к этому чату — менеджер ответит здесь.\nЕсли есть вопросы по размерам или доставке, напишите их прямо сюда.`,
    );
  }

  /** Сообщение боту от привязанного чата → в ленту последней привязанной заявки. false — чат не наш. */
  async incoming(chatId: string, m: TgMessage): Promise<boolean> {
    const lead = await this.prisma.premiumLead.findFirst({ where: { telegramChatId: chatId }, orderBy: { telegramLinkedAt: 'desc' } });
    if (!lead) return false;
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    if (!text) {
      await this.tg.send(chatId, 'Пока принимаем только текст — напишите, пожалуйста, вопрос сообщением.');
      return true;
    }
    // Флуд из чата не должен заваливать ленту и почту менеджера
    const allowed = await this.limits.hit('premium-tg-in', chatId, 30, 600).then(() => true, () => false);
    if (!allowed) return true;
    const unreadBefore = await this.prisma.premiumLeadMessage.count({ where: { leadId: lead.id, direction: 'incoming', readAt: null } });
    await this.prisma.premiumLeadMessage.create({ data: { leadId: lead.id, direction: 'incoming', channel: 'telegram', text: text.slice(0, MAX_TEXT), status: 'received' } });
    // Одно письмо на серию: следующее — после того как менеджер прочитал предыдущие
    if (config.alertEmail && unreadBefore === 0) {
      await this.mail
        .send('premium.lead_message', config.alertEmail, {
          'lead.name': lead.name, 'lead.no': premiumLeadNo(lead.no), text: text.slice(0, 1000), adminUrl: `${config.webOrigin}/admin/premium/${lead.id}`,
        })
        .catch((e: Error) => this.logger.error(`premium message mail: ${e.message}`));
    }
    return true;
  }

  // ─── админка ─────────────────────────────────────────────────────────

  async thread(leadId: string) {
    const rows = await this.prisma.premiumLeadMessage.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' }, include: { staff: { select: { email: true } } }, take: 500 });
    return rows.map((r) => ({
      id: r.id, direction: r.direction, channel: r.channel, text: r.text, status: r.status, error: r.error,
      staff: r.staff?.email ?? null, readAt: r.readAt, createdAt: r.createdAt,
    }));
  }

  telegramInfo(l: PremiumLead) {
    return {
      available: this.telegramAvailable,
      linked: Boolean(l.telegramChatId),
      linkedAt: l.telegramLinkedAt,
      linkPending: Boolean(l.telegramCodeHash && l.telegramCodeExpiresAt && l.telegramCodeExpiresAt > new Date()),
      linkExpiresAt: l.telegramCodeExpiresAt,
    };
  }

  /** Ответ в Telegram или заметка «написал в WhatsApp». Входящие при ответе считаются прочитанными. */
  async post(leadId: string, input: PremiumMessageInput, staff: User) {
    const lead = await this.prisma.premiumLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException({ message: 'Заявка не найдена' });
    let status: 'sent' | 'failed' | 'offline' = 'offline';
    let error: string | null = null;
    if (input.channel === 'telegram') {
      if (!this.tg.enabled) throw new BadRequestException({ message: 'Telegram-бот не подключён (нет TELEGRAM_BOT_TOKEN)' });
      if (!lead.telegramChatId) throw new BadRequestException({ message: 'Клиент не привязал Telegram — отправьте ему ссылку на бота' });
      const r = await this.tg.deliver(lead.telegramChatId, input.text);
      status = r.ok ? 'sent' : 'failed';
      error = r.ok ? null : r.error.slice(0, 300);
    }
    const msg = await this.prisma.premiumLeadMessage.create({
      data: { leadId, direction: 'outgoing', channel: input.channel, text: input.text, staffId: staff.id, status, error },
    });
    await this.markRead(leadId);
    await this.audit.log(staff.id, 'premium.lead.message', 'premium_lead', leadId, { channel: input.channel, status });
    return { id: msg.id, status, error };
  }

  async markRead(leadId: string) {
    const r = await this.prisma.premiumLeadMessage.updateMany({ where: { leadId, direction: 'incoming', readAt: null }, data: { readAt: new Date() } });
    return { ok: true, read: r.count };
  }

  /** Непрочитанные входящие: всего (для меню) */
  unreadTotal() {
    return this.prisma.premiumLeadMessage.count({ where: { direction: 'incoming', readAt: null } });
  }

  /** Непрочитанные по заявкам (для списка) */
  async unreadByLead(leadIds: string[]) {
    if (!leadIds.length) return new Map<string, number>();
    const rows = await this.prisma.premiumLeadMessage.groupBy({ by: ['leadId'], where: { leadId: { in: leadIds }, direction: 'incoming', readAt: null }, _count: true });
    return new Map(rows.map((r) => [r.leadId, r._count]));
  }
}
