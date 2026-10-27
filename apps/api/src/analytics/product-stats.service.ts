import { Injectable, Logger } from '@nestjs/common';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';

/** Поисковые и служебные роботы, превью ссылок, безголовые браузеры и консольные клиенты — не просмотры */
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|yandex(?!browser|searchbrowser)[a-z]*\/|mediapartners|facebookexternalhit|vkshare|telegrambot|whatsapp|skypeuripreview|preview|headless|lighthouse|pagespeed|phantomjs|selenium|puppeteer|playwright|curl\/|wget\/|python-|httpclient|okhttp|go-http|java\//i;
export const isBotUserAgent = (ua: string | undefined) => !ua?.trim() || BOT_UA.test(ua);
/** Повторный просмотр того же товара той же сессией в пределах часа не считается */
const VIEW_DEDUP_S = 3600;

/**
 * Лёгкие счётчики для аналитики поставщика: агрегат «товар × день (по Москве)» — просмотры карточки и добавления
 * в корзину. Без ПДн: ни пользователя, ни IP, ни cookie — только инкремент числа. Ошибка счётчика не ломает запрос.
 */
@Injectable()
export class ProductStatsService {
  private readonly logger = new Logger('ProductStats');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Просмотр карточки при отдаче страницы товара: без роботов (по User-Agent) и без повторов одной сессии за час.
   * Сессия — cookie sid, у гостя без cookie — IP + User-Agent; в Redis лежит только хэш на час, в базе — число.
   */
  async viewOnce(productId: string, who: { sid?: string; ip?: string; ua?: string }) {
    try {
      if (isBotUserAgent(who.ua)) return false;
      const subject = sha256(who.sid ? `sid:${who.sid}` : `ip:${who.ip ?? ''}|${who.ua ?? ''}`).slice(0, 32);
      const fresh = await this.redis.client.set(`pv:${productId}:${subject}`, '1', 'EX', VIEW_DEDUP_S, 'NX');
      if (fresh !== 'OK') return false;
      await this.view(productId);
      return true;
    } catch (e) {
      this.logger.warn(`view: ${(e as Error).message}`);
      return false;
    }
  }

  /** Просмотр карточки товара (вызывается витриной при отдаче страницы товара) */
  async view(productId: string) {
    await this.bump([productId], 'views');
  }

  /** Добавления в корзину вошедшего покупателя (корзина гостя живёт в браузере и попадает сюда при входе) */
  async cartAdds(productIds: string[]) {
    await this.bump(productIds, 'cartAdds');
  }

  private async bump(productIds: string[], field: 'views' | 'cartAdds') {
    if (!productIds.length) return;
    try {
      // Повторы товара в пачке складываются: unnest + GROUP BY
      if (field === 'views') {
        await this.prisma.$executeRaw`
          INSERT INTO product_daily_stats ("productId", day, views)
          SELECT p, (now() AT TIME ZONE 'Europe/Moscow')::date, COUNT(*)::int FROM unnest(${productIds}::uuid[]) AS p
          WHERE EXISTS (SELECT 1 FROM products WHERE id = p) GROUP BY p
          ON CONFLICT ("productId", day) DO UPDATE SET views = product_daily_stats.views + EXCLUDED.views`;
      } else {
        await this.prisma.$executeRaw`
          INSERT INTO product_daily_stats ("productId", day, "cartAdds")
          SELECT p, (now() AT TIME ZONE 'Europe/Moscow')::date, COUNT(*)::int FROM unnest(${productIds}::uuid[]) AS p
          WHERE EXISTS (SELECT 1 FROM products WHERE id = p) GROUP BY p
          ON CONFLICT ("productId", day) DO UPDATE SET "cartAdds" = product_daily_stats."cartAdds" + EXCLUDED."cartAdds"`;
      }
    } catch (e) {
      this.logger.warn(`${field}: ${(e as Error).message}`);
    }
  }
}
