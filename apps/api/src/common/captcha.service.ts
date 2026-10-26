import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../config';

/** Токен SmartCaptcha из заголовка X-Captcha-Token (форма присылает его после ответа captcha_required) */
export const captchaToken = (req: Request): string | undefined => {
  const v = req.headers['x-captcha-token'];
  return typeof v === 'string' ? v : undefined;
};

export type CaptchaVerdict = 'ok' | 'invalid' | 'unavailable';

/**
 * Проверка капчи в рамках одного запроса. Вход проверяет два счётчика (по IP и по email) —
 * токен SmartCaptcha одноразовый, поэтому результат проверки запоминается и сервис вызывается один раз.
 */
export interface CaptchaGate {
  readonly enabled: boolean;
  /** Пропускает при верном токене, иначе — 429 с кодом captcha_required */
  require(): Promise<void>;
}

const captchaRequired = (message: string) => new HttpException({ message, code: 'captcha_required' }, HttpStatus.TOO_MANY_REQUESTS);

/** Яндекс SmartCaptcha (ТЗ §11): без ключей выключена, лимиты отвечают 429 как раньше. */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger('SmartCaptcha');

  get enabled(): boolean {
    return Boolean(config.captcha.serverKey && config.captcha.clientKey);
  }

  /** Ключ клиента для виджета; null — капча выключена */
  get siteKey(): string | null {
    return this.enabled ? config.captcha.clientKey : null;
  }

  /**
   * POST https://smartcaptcha.yandexcloud.net/validate (secret, token, ip).
   * Сеть, таймаут, 5xx — «unavailable»: без капчи не пускаем, но и не падаем с 500.
   */
  async verify(token: string, ip: string): Promise<CaptchaVerdict> {
    try {
      const res = await fetch(config.captcha.validateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: config.captcha.serverKey, token, ip }),
        signal: AbortSignal.timeout(config.captcha.timeoutMs),
      });
      if (!res.ok) {
        this.logger.warn(`validate → HTTP ${res.status}`);
        return 'unavailable';
      }
      const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      if (body.status === 'ok') return 'ok';
      if (body.message) this.logger.warn(`validate: ${body.message}`);
      return 'invalid';
    } catch (e) {
      this.logger.warn(`validate недоступен: ${(e as Error).message}`);
      return 'unavailable';
    }
  }

  gate(token: string | undefined, ip: string): CaptchaGate {
    const enabled = this.enabled;
    let verdict: Promise<CaptchaVerdict> | undefined;
    return {
      enabled,
      require: async () => {
        const t = token?.trim();
        if (!t) throw captchaRequired('Подтвердите, что вы не робот');
        if (t.length > 2000) throw captchaRequired('Проверка не пройдена, попробуйте ещё раз');
        verdict ??= this.verify(t, ip);
        const v = await verdict;
        if (v === 'invalid') throw captchaRequired('Проверка не пройдена, попробуйте ещё раз');
        if (v === 'unavailable') throw captchaRequired('Проверка временно недоступна. Попробуйте через минуту.');
      },
    };
  }
}
