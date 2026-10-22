import { Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_SIZE_CHART, SIZES } from '@aesculap/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { config } from '../config';

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
  ) {}

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
    const ids = new Set<string>();
    for (const v of variants) {
      const like = `%${v.replace(/[%_\\]/g, '\\$&')}%`;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM products p JOIN brands b ON b.id = p."brandId"
        WHERE p."moderationStatus" = 'published'
          AND (p.title ILIKE ${like} OR b.name ILIKE ${like} OR word_similarity(${v}, lower(p.title)) > 0.35)
        LIMIT 2000`;
      rows.forEach((r) => ids.add(r.id));
    }
    return [...ids];
  }

  private async baseWhere(query: CatalogQuery) {
    const scope = await this.categoryScope(query.category);
    const and: Prisma.ProductWhereInput[] = [visibleWhere()];
    if (scope.ids) and.push({ categoryId: { in: scope.ids } });
    if (query.q?.trim()) and.push({ id: { in: await this.searchIds(query.q.trim()) } });
    return { where: { AND: and } as Prisma.ProductWhereInput, scope };
  }

  async list(query: CatalogQuery) {
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
      ...(from || to ? { price: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(query.sale === '1' ? { oldPrice: { not: null } } : {}),
    };

    const candidates = await this.prisma.product.findMany({ where: { AND: [productWhere, { variants: { some: variantWhere } }] }, select: { id: true, publishedAt: true } });
    const ids = candidates.map((c) => c.id);
    const mins = ids.length
      ? await this.prisma.productVariant.groupBy({ by: ['productId'], where: { ...variantWhere, productId: { in: ids } }, _min: { price: true } })
      : [];
    const minPrice = new Map(mins.map((m) => [m.productId, m._min.price ?? 0]));
    const published = new Map(candidates.map((c) => [c.id, c.publishedAt?.getTime() ?? 0]));
    const sorted = [...ids].sort((a, b) => {
      if (query.sort === 'price_asc') return minPrice.get(a)! - minPrice.get(b)!;
      if (query.sort === 'price_desc') return minPrice.get(b)! - minPrice.get(a)!;
      return published.get(b)! - published.get(a)!; // «Рекомендуемые» и «Новинки» — пока по дате публикации; продажи появятся на этапе 4
    });

    const perPage = Math.min(60, Number(query.perPage) || PER_PAGE);
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
    const pageIds = sorted.slice((page - 1) * perPage, page * perPage);

    const [items, facets] = await Promise.all([this.cards(pageIds, variantWhere), this.facets(base)]);
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
  async cards(ids: string[], variantWhere: Prisma.ProductVariantWhereInput = { stock: { gt: 0 } }) {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        brand: { select: { name: true } },
        media: { where: { approved: true, type: 'photo' }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }], take: 2 },
        variants: { where: { stock: { gt: 0 } }, include: { color: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((p) => p !== undefined)
      .map((p) => {
        const matching = p.variants.filter((v) => matchesVariant(v, variantWhere));
        const pool = matching.length ? matching : p.variants;
        const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
        const sizes = [...new Set(pool.filter((v) => v.colorId === best.colorId).map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b));
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          brand: p.brand.name,
          images: p.media.map((m) => this.storage.publicUrl(m.storageKey.replace(/\.webp$/, '_thumb.webp'))),
          price: best.price,
          oldPrice: best.oldPrice,
          sale: p.variants.some((v) => v.oldPrice != null),
          color: best.color.name,
          sizes: sizes.length > 2 ? `${sizes[0]}–${sizes.at(-1)}` : sizes.join(', '),
          heightRange: best.heightRange,
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
      this.prisma.productVariant.aggregate({ where: inStock, _min: { price: true }, _max: { price: true } }),
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
      price: { min: price._min.price ?? 0, max: price._max.price ?? 0 },
    };
  }

  async product(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { AND: [{ slug }, visibleWhere()] },
      include: {
        brand: true,
        category: { include: { parent: true } },
        supplier: true,
        specialties: { include: { specialty: true } },
        media: { where: { approved: true }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }] },
        variants: { include: { color: true } },
        articles: { where: { article: { status: 'published' } }, include: { article: true }, take: 3 },
        collections: { where: { collection: { status: 'published' } }, include: { collection: { include: { _count: { select: { products: true } } } } }, take: 3 },
      },
    });
    if (!p) throw new NotFoundException({ message: 'Товар не найден или снят с продажи' });
    const variants = [...p.variants].sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
    return {
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
        url: this.storage.publicUrl(m.storageKey),
        thumbUrl: this.storage.publicUrl(m.type === 'photo' ? m.storageKey.replace(/\.webp$/, '_thumb.webp') : m.posterKey),
        posterUrl: this.storage.publicUrl(m.posterKey),
      })),
      variants: variants.map((v) => ({ id: v.id, sku: v.sku, size: v.size, heightRange: v.heightRange, color: { id: v.color.id, name: v.color.name, hex: v.color.hex }, price: v.price, oldPrice: v.oldPrice, stock: v.stock })),
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
  async home() {
    const hits = await this.prisma.product.findMany({ where: visibleWhere(), orderBy: { publishedAt: 'desc' }, select: { id: true }, take: 15 });
    return { hits: await this.cards(hits.map((h) => h.id)) };
  }

  /** Варианты для корзины гостя (ТЗ §6.1): актуальные цена и остаток. */
  async variants(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: ids.slice(0, 100) }, product: visibleWhere() },
      include: { color: true, product: { include: { brand: true, supplier: true, media: { where: { approved: true, type: 'photo' }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }], take: 1 } } } },
    });
    return rows.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      heightRange: v.heightRange,
      color: v.color.name,
      price: v.price,
      oldPrice: v.oldPrice,
      stock: v.stock,
      product: { slug: v.product.slug, title: v.product.title, brand: v.product.brand.name, supplier: v.product.supplier.legalName, image: v.product.media[0] ? this.storage.publicUrl(v.product.media[0].storageKey.replace(/\.webp$/, '_thumb.webp')) : null },
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

function matchesVariant(v: { size: string; colorId: string; heightRange: string | null; price: number; oldPrice: number | null; stock: number }, w: Prisma.ProductVariantWhereInput) {
  const inList = (cond: unknown, value: string | null) => !cond || ((cond as { in: string[] }).in ?? []).includes(value ?? '');
  const price = w.price as { gte?: number; lte?: number } | undefined;
  return (
    v.stock > 0 &&
    inList(w.size, v.size) &&
    inList(w.colorId, v.colorId) &&
    inList(w.heightRange, v.heightRange) &&
    (!price?.gte || v.price >= price.gte) &&
    (!price?.lte || v.price <= price.lte) &&
    (!w.oldPrice || v.oldPrice != null)
  );
}
