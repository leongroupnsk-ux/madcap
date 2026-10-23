import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { catalogChanged } from '../storefront/catalog-cache';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/** Действия, после которых товар может появиться на витрине или исчезнуть с неё — сбрасывают кэш каталога. */
const STOREFRONT_ACTIONS = /^(moderation\.product\.|moderation\.revision\.|product\.(hide|unhide|bulk_hide)|supplier\.(payouts|payout_details|block|unblock|status)|promotion\.(approve|reject|withdraw|update)|dictionary\.|storefront\.)/;

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async log(actorId: string | null, action: string, entity: string, entityId?: string, data?: Prisma.InputJsonValue) {
    await this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, data } });
    if (STOREFRONT_ACTIONS.test(action)) await catalogChanged(this.redis);
  }
}
