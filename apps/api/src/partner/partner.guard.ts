import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { PartnerApiKey, Supplier } from '@prisma/client';
import type { Request, Response } from 'express';
import { RedisService } from '../common/redis.service';
import { config } from '../config';
import { PartnerKeysService } from './partner-keys.service';

export type PartnerContext = { key: PartnerApiKey; supplier: Supplier };
type Req = Request & { partner?: PartnerContext };

/**
 * Аутентификация партнёрского API: `Authorization: Bearer <ключ>`. Ключ даёт доступ только к данным своего поставщика.
 * Лимит частоты — на ключ, окно 60 с (PARTNER_API_RPM, по умолчанию 120 запросов в минуту); 429 с Retry-After.
 */
@Injectable()
export class PartnerKeyGuard implements CanActivate {
  constructor(
    private readonly keys: PartnerKeysService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!m) throw new UnauthorizedException({ message: 'Нужен заголовок Authorization: Bearer <ключ API>' });
    const key = await this.keys.resolve(m[1]);
    if (!key) throw new UnauthorizedException({ message: 'Ключ API не найден или отозван' });
    if (key.supplier.status !== 'active') throw new ForbiddenException({ message: 'Кабинет поставщика не активен или заблокирован' });

    const limit = config.partnerApi.rpm;
    const bucket = `rl:partner:${key.id}`;
    const count = await this.redis.client.incr(bucket);
    if (count === 1) await this.redis.client.expire(bucket, 60);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      const ttl = Math.max(1, await this.redis.client.ttl(bucket));
      res.setHeader('Retry-After', String(ttl));
      throw new HttpException({ message: `Превышен лимит ${limit} запросов в минуту для ключа. Повторите через ${ttl} с.` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    req.partner = { key, supplier: key.supplier };
    return true;
  }
}

export const CurrentPartner = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Req>().partner as PartnerContext);
