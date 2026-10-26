import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { effective, shown } from '../promotions/price';
import { visibleWhere } from '../storefront/catalog.service';
import { PHOTOS, photosFor, thumbKey } from '../storefront/media-pick';

/** Сколько товаров держим в избранном */
export const FAVORITES_LIMIT = 200;

/** Избранное: у вошедшего — в базе, у гостя — в браузере (переносится при входе через merge). */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async ids(userId: string) {
    const rows = await this.prisma.favorite.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { productId: true } });
    return rows.map((r) => r.productId);
  }

  async add(userId: string, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, moderationStatus: { in: ['published', 'hidden'] } }, select: { id: true } });
    if (!p) throw new NotFoundException({ message: 'Товар не найден' });
    await this.prisma.favorite.upsert({ where: { userId_productId: { userId, productId } }, create: { userId, productId }, update: {} });
    await this.trim(userId);
    return { ids: await this.ids(userId) };
  }

  async remove(userId: string, productId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, productId } });
    return { ids: await this.ids(userId) };
  }

  /** Перенос избранного гостя при входе: объединение без дублей, неизвестные товары пропускаются */
  async merge(userId: string, productIds: string[]) {
    const known = await this.prisma.product.findMany({ where: { id: { in: [...new Set(productIds)] }, moderationStatus: { in: ['published', 'hidden'] } }, select: { id: true } });
    if (known.length) await this.prisma.favorite.createMany({ data: known.map((p) => ({ userId, productId: p.id })), skipDuplicates: true });
    await this.trim(userId);
    return { ids: await this.ids(userId) };
  }

  private async trim(userId: string) {
    const extra = await this.prisma.favorite.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: FAVORITES_LIMIT, select: { productId: true } });
    if (extra.length) await this.prisma.favorite.deleteMany({ where: { userId, productId: { in: extra.map((e) => e.productId) } } });
  }

  /**
   * Карточки избранного в заданном порядке — в том числе снятые с продажи и без остатка («нет в наличии»).
   * Черновики и отклонённые товары не показываются.
   */
  async cards(ids: string[]) {
    const list = [...new Set(ids)].slice(0, FAVORITES_LIMIT);
    if (!list.length) return [];
    const [rows, visible] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: list }, moderationStatus: { in: ['published', 'hidden'] } },
        include: { brand: { select: { name: true } }, media: PHOTOS, variants: { include: { color: true } } },
      }),
      this.prisma.product.findMany({ where: { AND: [{ id: { in: list } }, visibleWhere()] }, select: { id: true } }),
    ]);
    const ok = new Set(visible.map((v) => v.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return list
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined && p.variants.length > 0)
      .map((p) => {
        const inStock = p.variants.filter((v) => v.stock > 0);
        const pool = inStock.length ? inStock : p.variants;
        const best = pool.reduce((a, b) => (effective(b) < effective(a) ? b : a));
        const photo = photosFor(p.media, best.colorId)[0];
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          brand: p.brand.name,
          image: this.storage.publicUrl(thumbKey(photo)),
          imageSet: this.storage.cardSet(photo?.storageKey),
          ...shown(best),
          color: best.color.name,
          available: ok.has(p.id) && inStock.length > 0,
        };
      });
  }
}
