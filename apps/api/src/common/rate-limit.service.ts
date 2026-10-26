import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { CaptchaGate } from './captcha.service';
import { RedisService } from './redis.service';

/** С капчей жёсткий потолок выше обычного лимита во столько раз — от перебора с решёнными капчами */
const CAPTCHA_HARD_FACTOR = 4;

/** Порог, после которого нужна капча: «чуть ниже» лимита (5 → 4, 10 → 8, 20 → 16, 3 → 2). */
export const captchaThreshold = (limit: number) => Math.max(1, limit - Math.max(1, Math.floor(limit / 5)));

/** Счётчик попыток в фиксированном окне. Ключи: rl:<действие>:<субъект>. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Без капчи (или когда она выключена) — 429 после limit попыток, как раньше.
   * С включённой капчей: после порога captchaThreshold(limit) запрос проходит только с верным токеном
   * (иначе 429 + code captcha_required), а 429 без вариантов — лишь после limit × 4.
   */
  async hit(action: string, subject: string, limit: number, windowSec: number, captcha?: CaptchaGate): Promise<void> {
    const key = `rl:${action}:${subject}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSec);
    if (captcha?.enabled) {
      if (count <= captchaThreshold(limit)) return;
      if (count > limit * CAPTCHA_HARD_FACTOR) throw await this.tooMany(key);
      await captcha.require();
      return;
    }
    if (count > limit) throw await this.tooMany(key);
  }

  async reset(action: string, subject: string): Promise<void> {
    await this.redis.client.del(`rl:${action}:${subject}`);
  }

  private async tooMany(key: string) {
    const ttl = await this.redis.client.ttl(key);
    return new HttpException({ message: `Слишком много попыток. Повторите через ${Math.ceil(Math.max(ttl, 1) / 60)} мин.` }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
