import type { RedisService } from '../common/redis.service';

/**
 * Версия кэша каталога: меняется, когда товар появляется на витрине или исчезает с неё
 * (модерация, снятие с витрины, выплаты поставщика). Остальное устаревает по TTL (≤ 30 с).
 */
export const CATALOG_VERSION_KEY = 'catalog:ver';

export async function catalogChanged(redis: RedisService) {
  await redis.client.incr(CATALOG_VERSION_KEY);
}
