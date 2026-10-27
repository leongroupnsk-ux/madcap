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
import { DeliveryService, parcelOf } from '../delivery/delivery.service';
import { PHOTOS, photosFor, thumbKey } from './media-pick';
import { corrections, expandSynonyms, looksPersonal, normalizeQuery, significant, swapLayout, typoBudget, vocabWords, words } from './search-text';

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
  /** «Только подходящее вам» (панель фильтров макета): товары, подходящие профилю покупателя */
  fit?: string;
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

export { swapLayout } from './search-text';

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
    private readonly delivery: DeliveryService,
  ) {}

  /** Короткий кэш в Redis для тяжёлых расчётов выдачи (ТЗ §11: p95 каталога ≤ 300 мс). */
  async cached<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
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

  /**
   * Словарь витрины для исправления опечаток: слова из названий опубликованных товаров, брендов и категорий.
   * Кэш — 10 минут в версии каталога (публикация и снятие товара его сбрасывают).
   */
  private vocabulary(): Promise<string[]> {
    return this.cached('search:vocab', 600, async () => {
      const rows = await this.prisma.$queryRaw<{ w: string }[]>`
        SELECT DISTINCT w FROM (
          SELECT unnest(regexp_split_to_array(lower(title), '[^a-zа-яё0-9]+')) AS w FROM products WHERE "moderationStatus" = 'published'
          UNION ALL SELECT unnest(regexp_split_to_array(lower(name), '[^a-zа-яё0-9]+')) FROM brands
          UNION ALL SELECT unnest(regexp_split_to_array(lower(name), '[^a-zа-яё0-9]+')) FROM categories
        ) t WHERE length(w) >= 3
        LIMIT 50000`;
      return [...new Set(rows.flatMap((r) => vocabWords(r.w)))];
    });
  }

  /**
   * План поиска: варианты строки (как есть, в другой раскладке, с заменой по синонимам), в каждом —
   * значимые слова, у каждого слова — само слово и исправления опечаток по словарю.
   * Товар подходит, если по какому-то варианту совпали все его слова. Слова, набранные покупателем (от 4 букв), ищутся
   * нестрого (подстрока, похожее слово); слова из словаря синонимов и исправления — только с начала слова,
   * иначе «топ» находил бы «орТОПедические», а «хирургичка» — «шапочку хирургическую».
   */
  private async searchPlan(q: string): Promise<SearchTerm[][][]> {
    const base = normalizeQuery(q);
    const vocab = await this.vocabulary();
    const plans: SearchTerm[][][] = [];
    for (const typed of new Set([base, normalizeQuery(swapLayout(base))])) {
      const own = new Set(words(typed));
      for (const str of expandSynonyms(typed)) {
        const ws = significant(words(str)).slice(0, 6);
        if (!ws.length) continue;
        // Короткие (до 3 букв) набранные слова — тоже с начала слова: подстрока «топ» есть в каждом «ортопедическом»
        plans.push(ws.map((w) => (own.has(w) ? [{ w, exact: w.length <= 3 }, ...corrections(w, vocab).map((c) => ({ w: c, exact: true }))] : [{ w, exact: true }])));
      }
    }
    return plans.slice(0, 16);
  }

  /**
   * id товаров по поисковой строке: подстрока или похожее слово (pg_trgm word similarity) в названии,
   * бренде или категории; опечатки — по словарю, синонимы, другая раскладка (searchPlan). Один SQL-запрос.
   */
  private async searchIds(q: string): Promise<string[]> {
    const norm = normalizeQuery(q);
    return this.cached(`search:${norm}`, 60, async () => {
      const plans = await this.searchPlan(norm);
      if (!plans.length) return [];
      const term = ({ w, exact }: SearchTerm) => {
        if (exact) {
          // С начала слова: (^|не буква)слово; ё в названиях приравнивается к е, как в словаре
          const re = `(^|[^a-zа-я0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
          return Prisma.sql`(translate(lower(p.title), 'ё', 'е') ~ ${re} OR translate(lower(b.name), 'ё', 'е') ~ ${re} OR translate(lower(c.name), 'ё', 'е') ~ ${re})`;
        }
        const like = `%${w.replace(/[%_\\]/g, '\\$&')}%`;
        return Prisma.sql`(p.title ILIKE ${like} OR ${w} <% p.title OR b.name ILIKE ${like} OR c.name ILIKE ${like})`;
      };
      const cond = Prisma.join(
        plans.map((plan) => Prisma.sql`(${Prisma.join(plan.map((alts) => Prisma.sql`(${Prisma.join(alts.map(term), ' OR ')})`), ' AND ')})`),
        ' OR ',
      );
      // Оператор <% (word similarity) и ILIKE идут по GIN-индексу триграмм; порог — только для этой транзакции.
      const rows = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL pg_trgm.word_similarity_threshold = 0.35');
        return tx.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM products p
          JOIN brands b ON b.id = p."brandId"
          JOIN categories c ON c.id = p."categoryId"
          WHERE p."moderationStatus" = 'published' AND (${cond})
          LIMIT 2000`;
      });
      return rows.map((r) => r.id);
    });
  }

  /** Сколько из найденных товаров сейчас на витрине (без фильтров и категории) */
  private async visibleCount(ids: string[]) {
    return ids.length ? this.prisma.product.count({ where: { AND: [visibleWhere(), { id: { in: ids } }] } }) : 0;
  }

  /**
   * «Возможно, вы искали…» для пустой выдачи: слова с опечатками заменяются на ближайшие слова словаря
   * с запасом в одну опечатку сверх обычного; предлагаем, только если по исправленному запросу что-то есть.
   */
  async didYouMean(q: string): Promise<string | null> {
    const norm = normalizeQuery(q);
    const vocab = await this.vocabulary();
    for (const str of [norm, normalizeQuery(swapLayout(norm))]) {
      const ws = words(str);
      let changed = false;
      const fixed = ws.map((w) => {
        const best = corrections(w, vocab, Math.min(3, typoBudget(w.length) + 1), 1)[0];
        if (best && best !== w) changed = true;
        return best ?? w;
      });
      if (!changed) continue;
      const candidate = fixed.join(' ');
      if (candidate === norm) continue;
      if ((await this.visibleCount(await this.searchIds(candidate))) > 0) return candidate;
    }
    return null;
  }

  /** Журнал запросов без результатов: нормализованный текст, счётчик, последняя дата. Без пользователя и IP. */
  async logEmpty(q: string) {
    const norm = normalizeQuery(q);
    if (norm.length < 2 || looksPersonal(norm)) return;
    await this.prisma.$executeRaw`
      INSERT INTO search_empty_queries (query, count, "firstAt", "lastAt") VALUES (${norm}, 1, now(), now())
      ON CONFLICT (query) DO UPDATE SET count = search_empty_queries.count + 1, "lastAt" = now()`;
  }

  /** Пустые запросы для админки: самые частые за период */
  async emptyQueries(days: number, limit: number, contains?: string) {
    const since = new Date(Date.now() - days * 86400_000);
    const where: Prisma.SearchEmptyQueryWhereInput = { lastAt: { gte: since }, ...(contains ? { query: { contains: normalizeQuery(contains) } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.searchEmptyQuery.findMany({ where, orderBy: [{ count: 'desc' }, { lastAt: 'desc' }], take: limit }),
      this.prisma.searchEmptyQuery.count({ where }),
    ]);
    return { since, total, items: items.map((i) => ({ query: i.query, count: i.count, firstAt: i.firstAt, lastAt: i.lastAt })) };
  }

  private async baseWhere(query: CatalogQuery) {
    const scope = await this.categoryScope(query.category);
    const and: Prisma.ProductWhereInput[] = [visibleWhere()];
    if (scope.ids) and.push({ categoryId: { in: scope.ids } });
    const searchIds = query.q?.trim() ? await this.searchIds(query.q.trim()) : null;
    if (searchIds) and.push({ id: { in: searchIds } });
    return { where: { AND: and } as Prisma.ProductWhereInput, scope, searchIds };
  }

  async list(query: CatalogQuery, fit: FitContext | null = null) {
    const { where: base, scope, searchIds } = await this.baseWhere(query);
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

    // «Только подходящее вам» — поверх общего (кэшируемого) порядка, по профилю конкретного покупателя
    let ordered = sorted;
    if (query.fit === '1' && fit) {
      const rows = await this.prisma.product.findMany({
        where: { id: { in: sorted } },
        select: { id: true, gender: true, category: { select: { slot: true } }, specialties: { select: { specialtyId: true } }, variants: { where: { stock: { gt: 0 } }, select: { size: true, heightRange: true, stock: true } } },
      });
      const ok = new Set(rows.filter((r) => fitsProduct(r, fit)).map((r) => r.id));
      ordered = sorted.filter((id) => ok.has(id));
    }

    const perPage = Math.min(60, Number(query.perPage) || PER_PAGE);
    const total = ordered.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
    const pageIds = ordered.slice((page - 1) * perPage, page * perPage);

    const facetKey = JSON.stringify({ category: query.category, q: query.q?.trim().toLowerCase() });
    const [items, facets] = await Promise.all([this.cards(pageIds, priceRange, fit), this.cached(`facets:${facetKey}`, 120, () => this.facets(base))]);
    // Поиск ничего не нашёл на всей витрине (а не только с фильтрами) — в журнал пустых запросов и подсказка
    let didYouMean: string | null = null;
    if (searchIds && total === 0 && (await this.visibleCount(searchIds)) === 0) {
      await this.logEmpty(query.q!).catch(() => undefined);
      didYouMean = await this.didYouMean(query.q!);
    }
    return {
      /** «Возможно, вы искали…» — только при пустой выдаче поиска */
      didYouMean,
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
      /** Есть профиль для «Подходит вам» — можно включать фильтр «Только подходящее вам» */
      personal: fit !== null,
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
    const ratings = await this.ratings(rows.map((r) => r.id));
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
          // Те же фото набором размеров для srcset
          photos: photosFor(p.media, best.colorId).slice(0, 2).map((m) => this.storage.cardSet(m.storageKey)).filter((x) => x !== null),
          price: price.price,
          oldPrice: price.oldPrice,
          sale: p.variants.some((v) => v.oldPrice != null || v.salePrice != null),
          promo: p.variants.find((v) => v.salePromotion)?.salePromotion?.badge ?? null,
          color: best.color.name,
          sizes: sizes.length > 2 ? `${sizes[0]}–${sizes.at(-1)}` : sizes.join(', '),
          heightRange: best.heightRange,
          fits: fit ? fitsProduct(p, fit) : false,
          /** Средняя оценка и число одобренных отзывов; null — отзывов нет */
          rating: ratings.get(p.id) ?? null,
        };
      });
  }

  /** Средняя оценка и число одобренных отзывов по товарам — для карточек (без кэша: один groupBy по индексу) */
  async ratings(ids: string[]) {
    const out = new Map<string, { avg: number; count: number }>();
    if (!ids.length) return out;
    const rows = await this.prisma.review.groupBy({ by: ['productId'], where: { productId: { in: ids }, status: 'approved' }, _avg: { rating: true }, _count: { _all: true } });
    for (const r of rows) out.set(r.productId, { avg: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count._all });
    return out;
  }

  /**
   * Сводка отзывов товара: средняя, число, распределение по звёздам, посадка, 5 свежих для микроразметки.
   * Кэшируется в версии каталога: одобрение и снятие отзыва (moderation.review.*) сбрасывают кэш.
   */
  reviewSummary(productId: string) {
    return this.cached(`reviews:${productId}`, 300, async () => {
      const where = { productId, status: 'approved' as const };
      const [byRating, byFit, latest] = await Promise.all([
        this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
        this.prisma.review.groupBy({ by: ['fit'], where, _count: { _all: true } }),
        this.prisma.review.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: 5, select: { authorName: true, rating: true, text: true, publishedAt: true } }),
      ]);
      const count = byRating.reduce((n, r) => n + r._count._all, 0);
      const sum = byRating.reduce((n, r) => n + r.rating * r._count._all, 0);
      const distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: byRating.find((r) => r.rating === stars)?._count._all ?? 0 }));
      const fit = { small: 0, true_to_size: 0, large: 0 } as Record<'small' | 'true_to_size' | 'large', number>;
      for (const f of byFit) fit[f.fit] = f._count._all;
      const top = (Object.entries(fit) as [keyof typeof fit, number][]).sort((a, b) => b[1] - a[1])[0];
      return {
        count,
        avg: count ? Math.round((sum / count) * 10) / 10 : null,
        distribution,
        fit,
        /** Преобладающая посадка — «Размер: в основном в размер» */
        fitMost: count && top[1] > 0 ? top[0] : null,
        latest: latest.map((r) => ({ author: r.authorName, rating: r.rating, text: r.text, publishedAt: r.publishedAt })),
      };
    });
  }

  /** Одобренные отзывы товара на витрине: по 10, свежие сверху; с фото и ответом продавца */
  async reviews(slug: string, pageParam?: string) {
    const p = await this.prisma.product.findFirst({ where: { AND: [{ slug }, visibleWhere()] }, select: { id: true, supplier: { select: { legalName: true } } } });
    if (!p) throw new NotFoundException({ message: 'Товар не найден или снят с продажи' });
    const perPage = 10;
    const summary = await this.reviewSummary(p.id);
    const pages = Math.max(1, Math.ceil(summary.count / perPage));
    const page = Math.min(pages, Math.max(1, Number(pageParam) || 1));
    const rows = await this.prisma.review.findMany({
      where: { productId: p.id, status: 'approved' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return {
      summary: { count: summary.count, avg: summary.avg, distribution: summary.distribution, fit: summary.fit, fitMost: summary.fitMost },
      page,
      pages,
      items: rows.map((r) => ({
        id: r.id,
        author: r.authorName,
        rating: r.rating,
        fit: r.fit,
        text: r.text,
        publishedAt: r.publishedAt,
        photos: r.photos.map((key) => ({ url: this.storage.publicUrl(key), image: this.storage.imageSet(key) })),
        reply: r.reply ? { text: r.reply, at: r.replyAt, seller: p.supplier.legalName } : null,
      })),
    };
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
    const reviews = await this.reviewSummary(p.id);
    return {
      reviews,
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
        // Наборы для srcset: большое фото — копии оригинала, превью в ленте — копии превью карточки
        image: m.type === 'photo' ? this.storage.imageSet(m.storageKey, m.width, m.height) : null,
        thumb: m.type === 'photo' ? this.storage.cardSet(m.storageKey) : null,
      })),
      promo: promo ? { name: promo.name, badge: promo.badge, endsAt: promo.endsAt } : null,
      variants: variants.map((v) => ({ id: v.id, sku: v.sku, size: v.size, heightRange: v.heightRange, color: { id: v.color.id, name: v.color.name, hex: v.color.hex }, ...shown(v), stock: v.stock })),
      articles: p.articles.map((a) => ({ slug: a.article.slug, title: a.article.title, lead: a.article.lead, coverUrl: this.storage.publicUrl(a.article.coverKey), cover: this.storage.imageSet(a.article.coverKey) })),
      collections: p.collections.map((c) => ({ slug: c.collection.slug, title: c.collection.title, coverUrl: this.storage.publicUrl(c.collection.coverKey), cover: this.storage.imageSet(c.collection.coverKey), count: c.collection._count.products })),
    };
  }

  /**
   * Доставка на странице товара: тарифы СДЭК от склада поставщика до города покупателя по весу и габаритам
   * выбранного варианта (без варианта — первого в наличии); к срокам прибавляется срок отгрузки поставщика.
   * Цены — в копейках.
   */
  async deliveryEstimate(slug: string, variantId: string | undefined, cityCode: number) {
    const p = await this.prisma.product.findFirst({
      where: { AND: [{ slug }, visibleWhere()] },
      select: { supplier: { select: { cdekCityCode: true, shipDays: true, warehouseAddress: true } }, variants: { select: { id: true, stock: true, weightG: true, lengthMm: true, widthMm: true, heightMm: true } } },
    });
    if (!p) throw new NotFoundException({ message: 'Товар не найден или снят с продажи' });
    const v = (variantId && p.variants.find((x) => x.id === variantId)) || p.variants.find((x) => x.stock > 0) || p.variants[0];
    const from = p.supplier.warehouseAddress?.split(',')[0]?.trim() || null;
    const none = { from, pvz: null, courier: null, periodMin: null, periodMax: null };
    if (!p.supplier.cdekCityCode || !v) return none;
    const est = await this.delivery.estimate(p.supplier.cdekCityCode, cityCode, parcelOf([{ qty: 1, ...v }])).catch(() => null);
    if (!est) return none;
    const ship = p.supplier.shipDays;
    const opt = (q: { price: number; periodMin: number; periodMax: number } | null) => q && { price: q.price, periodMin: q.periodMin + ship, periodMax: q.periodMax + ship };
    const opts = [opt(est.pvz), opt(est.courier)].filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      from,
      pvz: opt(est.pvz),
      courier: opt(est.courier),
      periodMin: opts.length ? Math.min(...opts.map((o) => o.periodMin)) : null,
      periodMax: opts.length ? Math.max(...opts.map((o) => o.periodMax)) : null,
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
      products: products.map((p) => ({ slug: p.slug, title: p.title, brand: p.brand, price: p.price, image: p.images[0] ?? null, imageSet: p.photos[0] ?? null })),
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
      product: { slug: v.product.slug, title: v.product.title, brand: v.product.brand.name, supplier: v.product.supplier.legalName, image: this.storage.publicUrl(thumbKey(photosFor(v.product.media, v.colorId)[0])), imageSet: this.storage.cardSet(photosFor(v.product.media, v.colorId)[0]?.storageKey) },
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

/** Слово поиска: набранное покупателем (нестрого) или из словаря синонимов / исправление опечатки (с начала слова) */
type SearchTerm = { w: string; exact: boolean };

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
