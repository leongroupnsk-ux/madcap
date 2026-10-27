import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { RedisService } from '../common/redis.service';
import { config } from '../config';

/** Входящее сообщение боту (нужные поля Bot API) */
export type TgMessage = {
  message_id?: number;
  chat: { id: number; type?: string };
  from?: { first_name?: string; username?: string };
  text?: string;
  photo?: unknown[];
  document?: unknown;
  [k: string]: unknown;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

/**
 * Обработчик сообщений бота от другого модуля (премиум-заявки). start — /start <payload> с префиксом,
 * message — любое сообщение; вернул true — сообщение обработано, дальше не идёт.
 */
export type TgHandler = {
  startPrefix: string;
  start(chatId: string, payload: string, m: TgMessage): Promise<void>;
  message(chatId: string, m: TgMessage): Promise<boolean>;
};

/**
 * Telegram-бот платформы (ТЗ §7.9, §10). Обновления — опросом getUpdates (без вебхука), только в работающем API.
 * Привязка поставщика: пишет боту /start, бот выдаёт одноразовый код на 10 минут, код вводится в кабинете.
 * Привязка покупателя премиум-заявки: /start lead_<код> из ссылки t.me (обрабатывает PremiumMessagesService
 * через registerHandler; префикс lead_ отличает её от привязки поставщика).
 * Без TELEGRAM_BOT_TOKEN бот выключен, а сообщения копятся в `sent` (dev и тесты).
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  readonly sent: { chatId: string; text: string }[] = [];
  private offset = 0;
  private stopped = false;
  /** Включён ли бот (есть токен). Изменяемое — тесты включают бота с замоканным api() */
  enabled = Boolean(config.telegram.token);
  /** Имя бота для ссылок t.me: из TELEGRAM_BOT_USERNAME или getMe при старте */
  username = config.telegram.username.replace(/^@/, '');
  private handlers: TgHandler[] = [];

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    // Опрос getUpdates — только в работающем API, не в тестах.
    if (this.enabled && process.env.JOBS_INLINE !== '1') {
      if (!this.username) {
        void this.api<{ username?: string }>('getMe', {})
          .then((me) => (this.username = me.username ?? ''))
          .catch((e) => this.logger.warn(`getMe: ${(e as Error).message}`));
      }
      void this.poll();
    }
  }

  registerHandler(h: TgHandler) {
    this.handlers.push(h);
  }

  /** Ссылка t.me на бота с параметром /start; null — бот выключен или имя неизвестно */
  startLink(payload: string): string | null {
    if (!this.enabled || !this.username) return null;
    return `https://t.me/${this.username}?start=${payload}`;
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  /** Вызов Bot API (в тестах подменяется — без сети) */
  async api<T>(method: string, body: object): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(json.description ?? `Telegram ${method}: ${res.status}`);
    return json.result;
  }

  private async poll() {
    while (!this.stopped) {
      try {
        const updates = await this.api<TgUpdate[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u);
        }
      } catch (e) {
        this.logger.warn(`getUpdates: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /** Входящее сообщение боту: /start lead_… — привязка заявки, /start — код поставщика, остальное — обработчикам. */
  async handleUpdate(u: TgUpdate) {
    const m = u.message;
    const chatId = m?.chat.id;
    if (!m || !chatId) return;
    const id = String(chatId);
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    if (text === '/start' || text.startsWith('/start ')) {
      const payload = text.slice('/start'.length).trim();
      const h = payload && this.handlers.find((x) => payload.startsWith(x.startPrefix));
      if (h) {
        await h.start(id, payload.slice(h.startPrefix.length), m).catch((e) => this.logger.error(`start ${h.startPrefix}: ${(e as Error).message}`));
        return;
      }
      const code = String(randomInt(100000, 1000000));
      await this.redis.client.set(`tg:code:${code}`, String(chatId), 'EX', 600);
      await this.send(id, `Код привязки: ${code}\nВведите его в кабинете поставщика ${config.brandName} → Настройки → Уведомления. Код действует 10 минут.`);
      return;
    }
    for (const h of this.handlers) {
      const done = await h.message(id, m).catch((e) => (this.logger.error(`message: ${(e as Error).message}`), true));
      if (done) return;
    }
  }

  /** Код из кабинета → chat_id; код одноразовый. */
  async redeem(code: string): Promise<string | null> {
    const key = `tg:code:${code}`;
    const chatId = await this.redis.client.get(key);
    if (chatId) await this.redis.client.del(key);
    return chatId;
  }

  async send(chatId: string, text: string) {
    await this.deliver(chatId, text);
  }

  /** Отправка с результатом: для ленты переписки нужен статус доставки и текст ошибки */
  async deliver(chatId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.enabled) {
      this.sent.push({ chatId, text });
      return { ok: true };
    }
    try {
      await this.api('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
      return { ok: true };
    } catch (e) {
      const error = (e as Error).message;
      this.logger.warn(`sendMessage: ${error}`);
      return { ok: false, error };
    }
  }
}
