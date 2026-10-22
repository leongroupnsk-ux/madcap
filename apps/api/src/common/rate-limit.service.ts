import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Счётчик попыток в фиксированном окне. Ключи: rl:<действие>:<субъект>. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(action: string, subject: string, limit: number, windowSec: number): Promise<void> {
    const key = `rl:${action}:${subject}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSec);
    if (count > limit) {
      const ttl = await this.redis.client.ttl(key);
      throw new HttpException(
        { message: `Слишком много попыток. Повторите через ${Math.ceil(Math.max(ttl, 1) / 60)} мин.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async reset(action: string, subject: string): Promise<void> {
    await this.redis.client.del(`rl:${action}:${subject}`);
  }
}
