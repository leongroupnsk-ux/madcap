import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JobsService } from '../common/jobs.service';
import { RedisService } from '../common/redis.service';
import { config } from '../config';
import { TelegramService } from '../notifications/telegram.service';

export type ErrorSource = 'api' | 'jobs' | 'web' | 'browser';
export type ErrorReport = { source: ErrorSource; where: string; message: string };

const SOURCE: Record<ErrorSource, string> = { api: 'API', jobs: 'Фоновая задача', web: 'Сайт (сервер)', browser: 'Сайт (браузер покупателя)' };
/** Одна и та же ошибка — не чаще раза в 30 минут, повторы — в сводке */
const REPEAT_S = 1800;
/** Не больше 20 отдельных сообщений в час на весь сайт; дальше — только сводка */
const HOURLY_MAX = 20;
export const DIGEST_EVERY_MS = 600_000;
const K = { seen: 'erra:seen:', pending: 'erra:pending', label: 'erra:label', hour: 'erra:hour:' };

/**
 * Текст ошибки без персональных данных: сообщения уходят в Telegram (серверы вне РФ), поэтому адреса почты,
 * телефоны, длинные числа, идентификаторы, ссылки и токены заменяются метками. Полный текст — только в логе сервера.
 */
export function scrub(text: string, max = 300): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<ссылка>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<почта>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/(\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, '<телефон>')
    .replace(/\b\d{6,}\b/g, '<число>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<токен>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Путь без строки запроса; после первой части всё с цифрами или дефисом (слаги товаров, номера заказов, id)
 * заменено на :slug — одинаковая ошибка на разных товарах считается одной. Первая часть — раздел сайта, их немного.
 */
export function routeOf(path: string): string {
  const clean = path.split(/[?#]/)[0].slice(0, 200);
  return scrub(clean.split('/').map((s, i) => (i > 1 && /[\d-]/.test(s) ? ':slug' : s)).join('/'), 120) || '/';
}

/**
 * Сообщения об ошибках в Telegram (ALERT_TELEGRAM_CHAT_ID): сбои API (5xx), упавшие фоновые задачи, ошибки рендера
 * сайта и экран ошибки в браузере покупателя. Первая ошибка каждого вида приходит сразу, её повторы за 30 минут —
 * сводкой раз в 10 минут; больше 20 отдельных сообщений в час не бывает, при лавине — тоже сводка. Счётчики в Redis:
 * перезапуск API не приводит к повторной рассылке. Без чата (dev, тесты) — только лог.
 */
@Injectable()
export class ErrorAlertsService implements OnModuleInit {
  private readonly logger = new Logger('ErrorAlerts');

  constructor(
    private readonly redis: RedisService,
    private readonly telegram: TelegramService,
    private readonly jobs: JobsService,
  ) {}

  async onModuleInit() {
    this.jobs.register('errors.digest', () => this.digest());
    await this.jobs.repeat('errors.digest', DIGEST_EVERY_MS);
    this.jobs.onFinalFailure((name, err) => this.report({ source: 'jobs', where: name, message: `${err.name}: ${err.message}` }));
  }

  private get site() {
    try {
      return new URL(config.webOrigin).host;
    } catch {
      return config.brandName;
    }
  }

  async report(r: ErrorReport): Promise<void> {
    const where = scrub(r.where, 160);
    const message = scrub(r.message);
    try {
      const fp = createHash('sha1').update(`${r.source}|${where}|${message.replace(/\d+/g, '#')}`).digest('hex').slice(0, 16);
      const redis = this.redis.client;
      const first = await redis.set(K.seen + fp, '1', 'EX', REPEAT_S, 'NX');
      const hour = K.hour + new Date().toISOString().slice(0, 13);
      const sent = first ? await redis.incr(hour) : 0;
      if (sent === 1) await redis.expire(hour, 3600);
      if (first && sent <= HOURLY_MAX) {
        const tail = sent === HOURLY_MAX ? '\nЭто 20-е сообщение за час — дальше только сводка раз в 10 минут.' : '\nПовторы за 30 минут придут сводкой.';
        await this.send(`🔴 ${SOURCE[r.source]} — ${this.site}\n${where}\n${message}${tail}`);
        return;
      }
      await redis.multi().hincrby(K.pending, fp, 1).hset(K.label, fp, `${SOURCE[r.source]}: ${where} — ${message.slice(0, 120)}`).exec();
    } catch (e) {
      this.logger.warn(`не удалось учесть ошибку: ${(e as Error).message}`);
    }
  }

  /** Сводка повторов за прошедшие 10 минут (фоновая задача errors.digest) */
  async digest(): Promise<void> {
    const res = await this.redis.client.multi().hgetall(K.pending).hgetall(K.label).del(K.pending, K.label).exec();
    const pending = (res?.[0]?.[1] ?? {}) as Record<string, string>;
    const labels = (res?.[1]?.[1] ?? {}) as Record<string, string>;
    const rows = Object.entries(pending)
      .map(([fp, n]) => ({ n: Number(n), label: labels[fp] ?? fp }))
      .sort((a, b) => b.n - a.n);
    if (!rows.length) return;
    const total = rows.reduce((s, r) => s + r.n, 0);
    const top = rows.slice(0, 10).map((r) => `• ${r.n}× ${r.label}`);
    const more = rows.length > 10 ? [`…и ещё ${rows.length - 10} видов`] : [];
    await this.send([`🟠 ${this.site}: ещё ${total} ошибок за 10 минут`, ...top, ...more].join('\n'));
  }

  private async send(text: string) {
    this.logger.error(text);
    if (!config.alertTelegramChatId) return;
    const r = await this.telegram.deliver(config.alertTelegramChatId, text);
    if (!r.ok) this.logger.warn(`Telegram: ${r.error}`);
  }
}
