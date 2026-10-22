import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });
  async onModuleDestroy() {
    await this.client.quit();
  }
}
