import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { RedisService } from '../common/redis.service';
import { config } from '../config';

type Update = { update_id: number; message?: { chat: { id: number }; text?: string } };

/**
 * Telegram-бот уведомлений (ТЗ §7.9, §10). Привязка: поставщик пишет боту /start, бот выдаёт
 * одноразовый код на 10 минут, код вводится в кабинете. Без TELEGRAM_BOT_TOKEN бот выключен,
 * а сообщения копятся в `sent` (dev и тесты).
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  readonly sent: { chatId: string; text: string }[] = [];
  private offset = 0;
  private stopped = false;
  readonly enabled = Boolean(config.telegram.token);

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    // Опрос getUpdates — только в работающем API, не в тестах.
    if (this.enabled && process.env.JOBS_INLINE !== '1') void this.poll();
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  private async api<T>(method: string, body: object): Promise<T> {
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
        const updates = await this.api<Update[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] });
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

  /** Входящее сообщение боту: на /start — код привязки. */
  async handleUpdate(u: Update) {
    const chatId = u.message?.chat.id;
    if (!chatId || !u.message?.text?.startsWith('/start')) return;
    const code = String(randomInt(100000, 1000000));
    await this.redis.client.set(`tg:code:${code}`, String(chatId), 'EX', 600);
    await this.send(String(chatId), `Код привязки: ${code}\nВведите его в кабинете поставщика ${config.brandName} → Настройки → Уведомления. Код действует 10 минут.`);
  }

  /** Код из кабинета → chat_id; код одноразовый. */
  async redeem(code: string): Promise<string | null> {
    const key = `tg:code:${code}`;
    const chatId = await this.redis.client.get(key);
    if (chatId) await this.redis.client.del(key);
    return chatId;
  }

  async send(chatId: string, text: string) {
    if (!this.enabled) {
      this.sent.push({ chatId, text });
      return;
    }
    await this.api('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }).catch((e) => this.logger.warn(`sendMessage: ${(e as Error).message}`));
  }
}
