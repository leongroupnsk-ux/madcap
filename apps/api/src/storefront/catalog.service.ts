import { Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_SIZE_CHART, SIZES } from '@aesculap/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { SettingsService } from '../common/settings.service';
import { CATALOG_VERSION_KEY } from './catalog-cache';
import { StorageService } from '../common/storage.service';
import { effective, shown } from '../promotions/price';
import { config } from '../config';
import { PHOTOS, photosFor, thumbKey } from './media-pick';

export type CatalogQuery = {
  category?: string;
  q?: string;
  gender?: string | string[];
  size?: string | string[];
  color?: string | string[];
  brand?: string | string[];
  specialty?: string | string[];
  height?: string | string[];
  priceFrom?: string;
  priceTo?: string;
  sale?: string;
  sort?: string;
  page?: string;
  perPage?: string;
};

const PER_PAGE = 30;

/** Контекст покупателя для «Подходит вам» (ТЗ §4.3): пол, размеры по слотам, ростовка, специальности. */
export type FitContext = {
  gender: string | null;
  heightRange: string | null;
  specialtyIds: string[];
  sizeFor: (slot: string | null) => string | null;
};

function fitsProduct(
  p: { gender: string; category: { slot: string | null }; specialties: { specialtyId: string }[]; variants: { size: string; heightRange: string | null; stock: number }[] },
  fit: FitContext,
) {
  if (fit.gender && p.gender !== 'unisex' && p.gender !== fit.gender) return false;
  const size = fit.sizeFor(p.category.slot);
  const sizeOk = p.variants.some((v) => v.stock > 0 && (!size || v.size.toUpperCase() === size.toUpperCase()) && (!v.heightRange || !fit.heightRange || v.heightRange === fit.heightRange));
  const specOk = !p.specialties.length || p.specialties.some((s) => fit.specialtyIds.includes(s.specialtyId));
  return sizeOk && specOk;
}
const list = (v: string | string[] | undefined) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean));
const sizeRank = (s: string) => {
  const i = (SIZES as readonly string[]).indexOf(s.toUpperCase());
  return i >= 0 ? i : 100 + (Number(s) || 0);
};

/** Неверная раскладка: «rjcnfv» → «костюм» (ТЗ §4.1). */
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
export function swapLayout(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((c) => {
      const i = EN.indexOf(c);
      if (i >= 0) return RU[i];
      const j = RU.indexOf(c);
      return j >= 0 ? EN[j] : c;
    })
    .join('');
}

/**
 * Что видит покупатель (ТЗ §4.3, §7): опубликован, поставщик активен (и с выплатами — в проде),
 * есть хотя бы один вариант в наличии.
 */
export function visibleWhere(): Prisma.ProductWhereInput {
  return {
    moderationStatus: 'published',
    supplier: { status: 'active', ...(config.storefrontRequirePayouts ? { payoutStatus: 'active' as const } : {}) },
    variants: { some: { stock: { gt: 0 } } },
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  /** Короткий кэш в Redis для тяжёлых расчётов выдачи (ТЗ §11: p95 каталога ≤ 300 мс). */
  private async cached<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
    if (process.env.CATALOG_CACHE === 'off') return load();
    const ver = (await this.redis.client.get(CATALOG_VERSION_KEY)) ?? '0';
    const k = `catalog:v${ver}:${key}`;
    // Одновременные промахи по одному ключу ждут один расчёт, а не считают его каждый (лавина на холодном кэше).
    const running = this.inflight.get(k);
    if (running) return running as Promise<T>;
    const task = (async () => {
      const hit = await this.redis.client.get(k);
      if (hit) return JSON.parse(hit) as T;
      const value = await load();
      await this.redis.client.set(k, JSON.stringify(value), 'EX', ttlS);
      return value;
    })().finally(() => this.inflight.delete(k));
    this.inflight.set(k, task);
    return task;
  }

  private readonly inflight = new Map<string, Promise<unknown>>();

  async categories() {
    const all = await this.prisma.category.findMany({ orderBy: { position: 'asc' } });
    return all
      .filter((c) => !c.parentId)
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug, children: all.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, name: x.name, slug: x.slug })) }));
  }

  private async categoryScope(slug?: string) {
    if (!slug) return { ids: null, category: null };
    const category = await this.prisma.category.findUnique({ where: { slug }, include: { parent: true, children: true } });
    if (!category) throw new NotFoundException({ message: 'Категория не найдена' });
    return { ids: [category.id, ...category.children.map((c) => c.id)], category };
  }

  /** id товаров по поисковой строке: подстрока, бренд, триграммы (опечатки) и та же строка в другой раскладке. */
  private async searchIds(q: string): Promise<string[]> {
    const variants = [...new Set([q.toLowerCase(), swapLayout(q)])].filter((v) => v.length >= 2);
    return this.cached(`search:${variants.join('|')}`, 60, async () => {
      const ids = new Set<string>();
      for (const v of variants) {
        const like = `%${v.replace(/[%_\\]/g, '\\$&')}%`;
        // Оператор <% (word similarity) и ILIKE идут по GIN-индексу триграмм; порог — только для этой транзакции.
        const rows = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL pg_trgm.word_similarity_threshold = 0.35');
          return tx.$queryRaw<{ id: string }[]>`
            SELECT p.id FROM products p
            WHERE p."moderationStatus" = 'published'
              AND (p.title ILIKE ${like} OR ${v} <% p.title OR p."brandId" IN (SELECT b.id FROM brands b WHERE b.name ILIKE ${like}))
            LIMIT 2000`;
        });
        rows.forEach((r) => ids.add(r.id));
      }
      return [...ids];
    });
  }

  private async baseWhere(query: CatalogQuery) {
    const scope = await this.categoryScope(query.category);
    const and: Prisma.ProductWhereInput[] = [visibleWhere()];
    if (scope.ids) and.push({ categoryId: { in: scope.ids } });
    if (query.q?.trim()) and.push({ id: { in: await this.searchIds(query.q.trim()) } });
    return { where: { AND: and } as Prisma.ProductWhereInput, scope };
  }

  async list(query: CatalogQuery, fit: FitContext | null = null) {
    const { where: base, scope } = await this.baseWhere(query);
    const genders = list(query.gender).filter((g) => ['female', 'male', 'unisex'].includes(g)) as ('female' | 'male' | 'unisex')[];
    const brands = list(query.brand);
    const specialties = list(query.specialty);
    const productWhere: Prisma.ProductWhereInput = {
      AND: [
        base,
        genders.length ? { gender: { in: genders } } : {},
        brands.length ? { brand: { slug: { in: brands } } } : {},
        specialties.length ? { specialties: { some: { specialtyId: { in: specialties } } } } : {},
      ],
    };
    // Фильтры по варианту: подходящий вариант должен быть в наличии.
    const sizes = list(query.size);
    const colors = list(query.color);
    const heights = list(query.height);
    const from = Number(query.priceFrom) > 0 ? Math.round(Number(query.priceFrom) * 100) : undefined;
    const to = Number(query.priceTo) > 0 ? Math.round(Number(query.priceTo) * 100) : undefined;
    const variantWhere: Prisma.ProductVariantWhereInput = {
      stock: { gt: 0 },
      ...(sizes.length ? { size: { in: sizes } } : {}),
      ...(colors.length ? { colorId: { in: colors } } : {}),
      ...(heights.length ? { heightRange: { in: heights } } : {}),
      AND: [
        // Цена — с учётом акции: у акционного варианта сравниваем salePrice.
        from || to ? { OR: [{ salePrice: null, price: range(from, to) }, { salePrice: range(from, to) }] } : {},
        query.sale === '1' ? { OR: [{ oldPrice: { not: null } }, { salePrice: { not: null } }] } : {},
      ],
    };
    const priceRange: VariantFilter = { sizes, colors, heights, from, to, sale: query.sale === '1' };

    // Порядок выдачи кэшируется на 30 с: страницы одного запроса листаются без повторного расчёта.
    const listKey = JSON.stringify({ ...query, page: undefined, perPage: undefined });
    const sorted = await this.cached(`list:${listKey}`, 30, async () => {
      const where: Prisma.ProductWhereInput = { AND: [productWhere, { variants: { some: variantWhere } }] };
      if (query.sort !== 'price_asc' && query.sort !== 'price_desc') {
        // «Рекомендуемые» и «Новинки» — по дате публикации, без выборки вариантов
        const rows = await this.prisma.product.findMany({ where, select: { id: true }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }] });
        return rows.map((r) => r.id);
      }
      // Минимальная цена с учётом акции считается в базе: отдельно по вариантам без акции и с акцией.
      const vw: Prisma.ProductVariantWhereInput = { AND: [variantWhere, { product: productWhere }] };
      const [plain, sale] = await Promise.all([
        this.prisma.productVariant.groupBy({ by: ['productId'], where: { AND: [vw, { salePrice: null }] }, _min: { price: true } }),
        this.prisma.productVariant.groupBy({ by: ['productId'], where: { AND: [vw, { salePrice: { not: null } }] }, _min: { salePrice: true } }),
      ]);
      const minPrice = new Map<string, number>();
      for (const r of plain) minPrice.set(r.productId, r._min.price!);
      for (const r of sale) minPrice.set(r.productId, Math.min(minPrice.get(r.productId) ?? Infinity, r._min.salePrice!));
      const dir = query.sort === 'price_asc' ? 1 : -1;
      return [...minPrice.entries()].sort((a, b) => dir * (a[1] - b[1]) || a[0].localeCompare(b[0])).map(([id]) => id);
    });

    const perPage = Math.min(60, Number(query.perPage) || PER_PAGE);
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
    const pageIds = sorted.slice((page - 1) * perPage, page * perPage);

    const facetKey = JSON.stringify({ category: query.category, q: query.q?.trim().toLowerCase() });
    const [items, facets] = await Promise.all([this.cards(pageIds, priceRange, fit), this.cached(`facets:${facetKey}`, 120, () => this.facets(base))]);
    return {
      category: scope.category && {
        name: scope.category.name,
        slug: scope.category.slug,
        parent: scope.category.parent && { name: scope.category.parent.name, slug: scope.category.parent.slug },
        children: scope.category.children.map((c) => ({ name: c.name, slug: c.slug })),
      },
      total,
      page,
      pages,
      perPage,
      items,
      facets,
    };
  }

  /** Карточки в заданном порядке; цена — минимальная среди подходящих вариантов в наличии. */
  async cards(ids: string[], filter: VariantFilter = {}, fit: FitContext | null = null) {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      // Видимость проверяется заново: порядок выдачи мог прийти из кэша.
      where: { AND: [{ id: { in: ids } }, visibleWhere()] },
      include: {
        brand: { select: { name: true } },
        category: { select: { slot: true } },
        specialties: { select: { specialtyId: true } },
        media: PHOTOS,
        variants: { where: { stock: { gt: 0 } }, include: { color: true, salePromotion: { select: { badge: true } } } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined && p.variants.length > 0)
      .map((p) => {
        const matching = p.variants.filter((v) => matchesVariant(v, filter));
        const pool = matching.length ? matching : p.variants;
        const best = pool.reduce((a, b) => (effective(b) < effective(a) ? b : a));
        const price = shown(best);
        const sizes = [...new Set(pool.filter((v) => v.colorId === best.colorId).map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b));
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          brand: p.brand.name,
          images: photosFor(p.media, best.colorId).slice(0, 2).map((m) => this.storage.publicUrl(thumbKey(m))),
          price: price.price,
          oldPrice: price.oldPrice,
          sale: p.variants.some((v) => v.oldPrice != null || v.salePrice != null),
          promo: p.variants.find((v) => v.salePromotion)?.salePromotion?.badge ?? null,
          color: best.color.name,
          sizes: sizes.length > 2 ? `${sizes[0]}–${sizes.at(-1)}` : sizes.join(', '),
          heightRange: best.heightRange,
          fits: fit ? fitsProduct(p, fit) : false,
        };
      });
  }

  /** Значения фильтров со счётчиками в пределах категории и поиска (ТЗ §4.4). */
  private async facets(base: Prisma.ProductWhereInput) {
    const inStock = { stock: { gt: 0 }, product: base };
    const [sizes, colors, heights, brands, specialties, price, genders] = await Promise.all([
      this.prisma.productVariant.groupBy({ by: ['size'], where: inStock, _count: { productId: true } }),
      this.prisma.productVariant.groupBy({ by: ['colorId'], where: inStock, _count: { productId: true } }),
      this.prisma.productVariant.groupBy({ by: ['heightRange'], where: { ...inStock, heightRange: { not: null } }, _count: { productId: true } }),
      this.prisma.product.groupBy({ by: ['brandId'], where: base, _count: { _all: true } }),
      this.prisma.productSpecialty.groupBy({ by: ['specialtyId'], where: { product: base }, _count: { _all: true } }),
      Promise.all([
        this.prisma.productVariant.aggregate({ where: { ...inStock, salePrice: null }, _min: { price: true }, _max: { price: true } }),
        this.prisma.productVariant.aggregate({ where: { ...inStock, salePrice: { not: null } }, _min: { salePrice: true }, _max: { salePrice: true } }),
      ]).then(([a, b]) => {
        const mins = [a._min.price, b._min.salePrice].filter((x): x is number => x != null);
        const maxs = [a._max.price, b._max.salePrice].filter((x): x is number => x != null);
        return { min: mins.length ? Math.min(...mins) : 0, max: maxs.length ? Math.max(...maxs) : 0 };
      }),
      this.prisma.product.groupBy({ by: ['gender'], where: base, _count: { _all: true } }),
    ]);
    const [colorRows, brandRows, specRows] = await Promise.all([
      this.prisma.color.findMany({ where: { id: { in: colors.map((c) => c.colorId) } } }),
      this.prisma.brand.findMany({ where: { id: { in: brands.map((b) => b.brandId) } } }),
      this.prisma.specialty.findMany({ where: { id: { in: specialties.map((s) => s.specialtyId) } } }),
    ]);
    const ru = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
    return {
      genders: genders.map((g) => ({ value: g.gender, count: g._count._all })),
      sizes: sizes.map((s) => ({ value: s.size, count: s._count.productId })).sort((a, b) => sizeRank(a.value) - sizeRank(b.value)),
      heights: heights.map((h) => ({ value: h.heightRange!, count: h._count.productId })).sort((a, b) => a.value.localeCompare(b.value)),
      colors: colorRows.map((c) => ({ id: c.id, name: c.name, hex: c.hex, count: colors.find((x) => x.colorId === c.id)!._count.productId })).sort(ru),
      brands: brandRows.map((b) => ({ slug: b.slug, name: b.name, count: brands.find((x) => x.brandId === b.id)!._count._all })).sort(ru),
      specialties: specRows.map((s) => ({ id: s.id, name: s.name, count: specialties.find((x) => x.specialtyId === s.id)!._count._all })).sort(ru),
      price,
    };
  }

  async product(slug: string, fit: FitContext | null = null) {
    const p = await this.prisma.product.findFirst({
      where: { AND: [{ slug }, visibleWhere()] },
      include: {
        brand: true,
        category: { include: { parent: true } },
        supplier: true,
        specialties: { include: { specialty: true } },
        media: { where: { approved: true }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }] },
        variants: { include: { color: true, salePromotion: true } },
        articles: { where: { article: { status: 'published' } }, include: { article: true }, take: 3 },
        collections: { where: { collection: { status: 'published' } }, include: { collection: { include: { _count: { select: { products: true } } } } }, take: 3 },
      },
    });
    if (!p) throw new NotFoundException({ message: 'Товар не найден или снят с продажи' });
    const variants = [...p.variants].sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
    const promo = variants.find((v) => v.salePromotion)?.salePromotion;
    const recommended = fit ? { size: fit.sizeFor(p.category.slot), heightRange: fit.heightRange } : null;
    return {
      fits: fit ? fitsProduct(p, fit) : false,
      recommended,
      id: p.id,
      slug: p.slug,
      title: p.title,
      brand: { name: p.brand.name, slug: p.brand.slug },
      sizeChart: (p.brand.sizeChart as unknown) ?? DEFAULT_SIZE_CHART,
      category: { name: p.category.name, slug: p.category.slug, parent: p.category.parent && { name: p.category.parent.name, slug: p.category.parent.slug } },
      gender: p.gender,
      fabric: p.fabric,
      treatment: p.treatment,
      washing: p.washing,
      description: p.description,
      externalId: p.externalId,
      specialties: p.specialties.map((s) => s.specialty.name),
      // Сведения о продавце обязательны для агрегатора (ЗоЗПП ст. 9).
      seller: { name: p.supplier.legalName, inn: p.supplier.inn, city: p.supplier.warehouseAddress?.split(',')[0]?.trim() || null, shipDays: p.supplier.shipDays },
      media: p.media.map((m) => ({
        id: m.id,
        type: m.type,
        colorId: m.colorId,
        url: this.storage.publicUrl(m.storageKey),
        thumbUrl: this.storage.publicUrl(m.type === 'photo' ? m.storageKey.replace(/\.webp$/, '_thumb.webp') : m.posterKey),
        posterUrl: this.storage.publicUrl(m.posterKey),
      })),
      promo: promo ? { name: promo.name, badge: promo.badge, endsAt: promo.endsAt } : null,
      variants: variants.map((v) => ({ id: v.id, sku: v.sku, size: v.size, heightRange: v.heightRange, color: { id: v.color.id, name: v.color.name, hex: v.color.hex }, ...shown(v), stock: v.stock })),
      articles: p.articles.map((a) => ({ slug: a.article.slug, title: a.article.title, lead: a.article.lead, coverUrl: this.storage.publicUrl(a.article.coverKey) })),
      collections: p.collections.map((c) => ({ slug: c.collection.slug, title: c.collection.title, coverUrl: this.storage.publicUrl(c.collection.coverKey), count: c.collection._count.products })),
    };
  }

  /** Подсказки поиска: товары, категории, бренды (ТЗ §4.1). */
  async suggest(q: string) {
    const term = q.trim();
    if (term.length < 2) return { products: [], categories: [], brands: [] };
    const alt = swapLayout(term);
    const ids = await this.searchIds(term);
    const visible = ids.length ? await this.prisma.product.findMany({ where: { AND: [visibleWhere(), { id: { in: ids } }] }, select: { id: true }, take: 6 }) : [];
    const [products, categories, brands] = await Promise.all([
      this.cards(visible.map((v) => v.id)),
      this.prisma.category.findMany({ where: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { name: { contains: alt, mode: 'insensitive' } }] }, take: 4 }),
      this.prisma.brand.findMany({ where: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { name: { contains: alt, mode: 'insensitive' } }] }, take: 4 }),
    ]);
    return {
      products: products.map((p) => ({ slug: p.slug, title: p.title, brand: p.brand, price: p.price, image: p.images[0] ?? null })),
      categories: categories.map((c) => ({ name: c.name, slug: c.slug })),
      brands: brands.map((b) => ({ name: b.name, slug: b.slug })),
    };
  }

  /** Главная (ТЗ §4.2): «Хиты недели» — пока свежие публикации; по продажам — после этапа 4. */
  /** Меню шапки — кэш как у главной, сбрасывается при сохранении витрины */
  menu() {
    return this.cached('menu', 300, async () => (await this.settings.storefront()).menu);
  }

  async home(fit: FitContext | null = null) {
    // Состав главной кэшируется на минуту; карточки (цены, остатки, «Подходит вам») — всегда свежие.
    const layout = await this.cached('home', 60, async () => {
      const sf = await this.settings.storefront();
      const visibleIds = async (ids: string[]) => {
        if (!ids.length) return [];
        const ok = new Set((await this.prisma.product.findMany({ where: { AND: [visibleWhere(), { id: { in: ids } }] }, select: { id: true } })).map((x) => x.id));
        return ids.filter((id) => ok.has(id));
      };
      // «Хиты недели» (ТЗ §4.2): закреплённые редактором, иначе — продажи за 7 дней, добираем новинками
      let hitIds = await visibleIds(sf.hitsProductIds);
      if (!hitIds.length) {
        const sold = await this.prisma.$queryRaw<{ productId: string }[]>`
          SELECT v."productId" FROM shipment_items si
          JOIN product_variants v ON v.id = si."variantId"
          JOIN shipments sh ON sh.id = si."shipmentId"
          WHERE sh."paidAt" > now() - interval '7 days' AND sh.status NOT IN ('cancelled', 'rejected')
          GROUP BY v."productId" ORDER BY sum(si.qty - si."returnedQty") DESC LIMIT 15`;
        hitIds = await visibleIds(sold.map((x) => x.productId));
      }
      if (hitIds.length < 10) {
        const fresh = await this.prisma.product.findMany({ where: { AND: [visibleWhere(), { id: { notIn: hitIds } }] }, orderBy: { publishedAt: 'desc' }, select: { id: true }, take: 10 - hitIds.length });
        hitIds = [...hitIds, ...fresh.map((x) => x.id)];
      }
      const capsuleIds = await visibleIds(sf.capsuleOfWeek.productIds);
      const hits = hitIds.map((id) => ({ id }));
      // Раздел акций на главной (ТЗ §7.7): идущие акции с флагом onHomepage и их товары.
      const now = new Date();
      const promos = await this.prisma.promotion.findMany({ where: { onHomepage: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { endsAt: 'asc' }, take: 2 });
      const promotions = [];
      for (const p of promos) {
        const ids = await this.prisma.product.findMany({ where: { AND: [visibleWhere(), { variants: { some: { salePromotionId: p.id, stock: { gt: 0 } } } }] }, select: { id: true }, take: 8 });
        if (ids.length) promotions.push({ name: p.name, badge: p.badge, description: p.description, endsAt: p.endsAt, ids: ids.map((x) => x.id) });
      }
      return { hits: hits.map((h) => h.id), promotions, hero: sf.hero, premium: sf.premium, capsule: capsuleIds.length >= 2 ? { title: sf.capsuleOfWeek.title, text: sf.capsuleOfWeek.text, ids: capsuleIds } : null };
    });
    const promotions = [];
    for (const { ids, ...p } of layout.promotions) promotions.push({ ...p, items: await this.cards(ids, undefined, fit) });
    return {
      hits: await this.cards(layout.hits, undefined, fit),
      promotions,
      hero: layout.hero,
      premium: layout.premium,
      capsuleOfWeek: layout.capsule && { title: layout.capsule.title, text: layout.capsule.text, items: await this.cards(layout.capsule.ids, undefined, fit) },
    };
  }

  /** Варианты для корзины гостя (ТЗ §6.1): актуальные цена и остаток. */
  async variants(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: ids.slice(0, 100) }, product: visibleWhere() },
      include: { color: true, product: { include: { brand: true, supplier: true, media: PHOTOS } } },
    });
    return rows.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      heightRange: v.heightRange,
      color: v.color.name,
      ...shown(v),
      stock: v.stock,
      product: { slug: v.product.slug, title: v.product.title, brand: v.product.brand.name, supplier: v.product.supplier.legalName, image: this.storage.publicUrl(thumbKey(photosFor(v.product.media, v.colorId)[0])) },
    }));
  }

  async sitemap() {
    const [products, categories, articles, collections] = await Promise.all([
      this.prisma.product.findMany({ where: visibleWhere(), select: { slug: true, updatedAt: true } }),
      this.prisma.category.findMany({ select: { slug: true } }),
      this.prisma.article.findMany({ where: { status: 'published' }, select: { slug: true, updatedAt: true } }),
      this.prisma.collection.findMany({ where: { status: 'published' }, select: { slug: true, updatedAt: true } }),
    ]);
    return { products, categories, articles, collections };
  }
}

type VariantFilter = { sizes?: string[]; colors?: string[]; heights?: string[]; from?: number; to?: number; sale?: boolean };
const range = (from?: number, to?: number) => ({ ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) });

function matchesVariant(v: { size: string; colorId: string; heightRange: string | null; price: number; oldPrice: number | null; salePrice: number | null; stock: number }, f: VariantFilter) {
  const inList = (list: string[] | undefined, value: string | null) => !list?.length || list.includes(value ?? '');
  const price = effective(v);
  return (
    v.stock > 0 &&
    inList(f.sizes, v.size) &&
    inList(f.colors, v.colorId) &&
    inList(f.heights, v.heightRange) &&
    (!f.from || price >= f.from) &&
    (!f.to || price <= f.to) &&
    (!f.sale || v.oldPrice != null || v.salePrice != null)
  );
}
