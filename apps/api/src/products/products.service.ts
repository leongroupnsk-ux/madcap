import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MIN_PHOTOS, toKopecks, toRubles, type ProductSaveInput, type VariantInput } from '@aesculap/shared';
import { Prisma, type Product, type ProductMedia, type ProductRevision, type ProductVariant, type Supplier, type User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { shortId, slugify } from '../common/slug';
import { MediaService } from './media.service';

/** Поля, правка которых у опубликованного товара идёт через модерацию (ТЗ §7.3). */
const TEXT_FIELDS = ['title', 'brandId', 'categoryId', 'gender', 'fabric', 'treatment', 'washing', 'description'] as const;
type TextFields = Pick<Product, (typeof TEXT_FIELDS)[number]>;

export type RevisionData = TextFields & {
  specialtyIds: string[];
  media: { order: string[]; mainId: string | null; removed: string[] };
};

type FullProduct = Product & {
  variants: ProductVariant[];
  media: ProductMedia[];
  specialties: { specialtyId: string }[];
  revisions: ProductRevision[];
  brand?: { name: string };
};

const include = {
  variants: { orderBy: [{ size: 'asc' }, { sku: 'asc' }] },
  media: { orderBy: { position: 'asc' } },
  specialties: { select: { specialtyId: true } },
  revisions: { where: { status: { in: ['pending', 'rejected'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
  brand: { select: { name: true } },
} satisfies Prisma.ProductInclude;

const LIVE = new Set(['published', 'hidden']);

export type ListQuery = { q?: string; status?: string; sort?: string; page?: number };

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  // ─── чтение ──────────────────────────────────────────────────────────

  async list(supplierId: string, query: ListQuery) {
    const take = 50;
    const page = Math.max(1, Number(query.page) || 1);
    const where: Prisma.ProductWhereInput = { supplierId };
    if (query.status === 'revision') where.revisions = { some: { status: 'pending' } };
    else if (query.status === 'out_of_stock') where.variants = { none: { stock: { gt: 0 } } };
    else if (query.status) where.moderationStatus = query.status as Product['moderationStatus'];
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
        { externalId: { contains: q, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'title' ? { title: 'asc' } : query.sort === 'created' ? { createdAt: 'desc' } : { updatedAt: 'desc' };

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * take,
        take,
        include: {
          brand: { select: { name: true } },
          variants: { select: { sku: true, size: true, price: true, stock: true } },
          media: { where: { type: 'photo' }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }], take: 1 },
          revisions: { where: { status: 'pending' }, select: { id: true }, take: 1 },
        },
      }),
    ]);

    return {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / take)),
      items: rows.map((p) => {
        const prices = p.variants.map((v) => v.price);
        const sizes = [...new Set(p.variants.map((v) => v.size))];
        return {
          id: p.id,
          title: p.title,
          brand: p.brand.name,
          sku: p.variants[0]?.sku ?? p.externalId ?? '—',
          thumbUrl: p.media[0] ? this.media.view(p.media[0]).thumbUrl : null,
          priceFrom: prices.length ? Math.min(...prices) : null,
          sizes: sizes.length > 2 ? `${sizes[0]}–${sizes[sizes.length - 1]}` : sizes.join(', '),
          stock: p.variants.reduce((s, v) => s + v.stock, 0),
          moderationStatus: p.moderationStatus,
          hasPendingRevision: p.revisions.length > 0,
          source: p.source,
          updatedAt: p.updatedAt,
        };
      }),
    };
  }

  /** Плитки дашборда (ТЗ §7.2): заказы и продажи появятся на этапе 4. */
  async summary(supplierId: string) {
    const [total, published, pending, revisions, zeroStock, lastImport] = await Promise.all([
      this.prisma.product.count({ where: { supplierId } }),
      this.prisma.product.count({ where: { supplierId, moderationStatus: 'published' } }),
      this.prisma.product.count({ where: { supplierId, moderationStatus: 'pending' } }),
      this.prisma.productRevision.count({ where: { status: 'pending', product: { supplierId } } }),
      this.prisma.product.count({ where: { supplierId, moderationStatus: 'published', variants: { none: { stock: { gt: 0 } } } } }),
      this.prisma.importJob.findFirst({ where: { supplierId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      total,
      published,
      onModeration: pending + revisions,
      zeroStock,
      lastImport: lastImport && {
        id: lastImport.id, fileName: lastImport.fileName, status: lastImport.status, totalRows: lastImport.totalRows,
        newProducts: lastImport.newProducts, updates: lastImport.updates, errorRows: lastImport.errorRows, createdAt: lastImport.createdAt,
      },
    };
  }

  async get(supplierId: string, id: string) {
    return this.view(await this.load(supplierId, id));
  }

  private async load(supplierId: string, id: string): Promise<FullProduct> {
    const p = await this.prisma.product.findFirst({ where: { id, supplierId }, include });
    if (!p) throw new NotFoundException({ message: 'Товар не найден' });
    return p;
  }

  /** Для поставщика: если есть ревизия на модерации — показываем его правки поверх живой версии. */
  view(p: FullProduct) {
    const revision = p.revisions[0];
    const rev = revision?.status === 'pending' ? (revision.data as unknown as RevisionData) : null;
    const text: TextFields = rev ? pickText(rev) : pickText(p);
    const specialtyIds = rev ? rev.specialtyIds : p.specialties.map((s) => s.specialtyId);
    const removed = new Set(rev?.media.removed ?? []);
    let media = p.media.filter((m) => !removed.has(m.id));
    if (rev) {
      const order = new Map(rev.media.order.map((id, i) => [id, i]));
      media = [...media].sort((a, b) => (order.get(a.id) ?? 999 + a.position) - (order.get(b.id) ?? 999 + b.position));
    }
    const mainId = rev ? rev.media.mainId : (p.media.find((m) => m.isMain)?.id ?? null);
    return {
      id: p.id,
      slug: p.slug,
      ...text,
      specialtyIds,
      moderationStatus: p.moderationStatus,
      rejectReason: p.rejectReason,
      source: p.source,
      manualOverride: p.manualOverride,
      externalId: p.externalId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      revision: revision ? { id: revision.id, status: revision.status, rejectReason: revision.rejectReason, createdAt: revision.createdAt } : null,
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        size: v.size,
        heightRange: v.heightRange,
        colorId: v.colorId,
        price: toRubles(v.price),
        oldPrice: v.oldPrice == null ? null : toRubles(v.oldPrice),
        stock: v.stock,
        weightG: v.weightG,
        lengthMm: v.lengthMm,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
      })),
      media: media.map((m) => ({ ...this.media.view(m), isMain: m.id === mainId })),
    };
  }

  // ─── запись ──────────────────────────────────────────────────────────

  /** Бренд, категория, специальности и цвета должны существовать — иначе понятная ошибка, а не 500. */
  private async checkRefs(input: ProductSaveInput) {
    const colorIds = [...new Set(input.variants.map((v) => v.colorId))];
    const [brand, category, specialties, colors] = await Promise.all([
      this.prisma.brand.count({ where: { id: input.brandId } }),
      this.prisma.category.count({ where: { id: input.categoryId } }),
      this.prisma.specialty.count({ where: { id: { in: input.specialtyIds } } }),
      this.prisma.color.count({ where: { id: { in: colorIds } } }),
    ]);
    const errors: Record<string, string> = {};
    if (!brand) errors.brandId = 'Бренд не найден';
    if (!category) errors.categoryId = 'Категория не найдена';
    if (specialties !== new Set(input.specialtyIds).size) errors.specialtyIds = 'Есть неизвестные специальности';
    if (colors !== colorIds.length) errors.variants = 'Есть неизвестные цвета';
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Проверьте поля формы', errors });
  }

  async create(supplier: Supplier, input: ProductSaveInput, actor: User) {
    await this.checkRefs(input);
    const product = await this.prisma.product.create({
      data: {
        supplierId: supplier.id,
        slug: `${slugify(input.title) || 'tovar'}-${shortId()}`,
        ...textData(input),
        moderationStatus: 'draft',
        source: 'manual',
        specialties: { create: input.specialtyIds.map((specialtyId) => ({ specialtyId })) },
      },
    });
    await this.syncVariants(product.id, input.variants);
    await this.audit.log(actor.id, 'product.create', 'product', product.id);
    return this.get(supplier.id, product.id);
  }

  /**
   * Сохранение. Черновик / отклонённый / на первичной модерации — правки применяются сразу.
   * Опубликованный / снятый — цены, остатки и варианты сразу, текст и медиа — в ревизию на модерацию.
   */
  async save(supplier: Supplier, id: string, input: ProductSaveInput, actor: User) {
    const p = await this.load(supplier.id, id);
    await this.checkRefs(input);
    const mediaIds = new Set(p.media.map((m) => m.id));
    const order = input.media.order.filter((m) => mediaIds.has(m));
    const mainId = input.media.mainId && order.includes(input.media.mainId) ? input.media.mainId : (order[0] ?? null);

    await this.syncVariants(p.id, input.variants);

    if (!LIVE.has(p.moderationStatus)) {
      await this.prisma.$transaction([
        this.prisma.product.update({ where: { id: p.id }, data: { ...textData(input), manualOverride: p.source !== 'manual' ? true : p.manualOverride } }),
        this.prisma.productSpecialty.deleteMany({ where: { productId: p.id } }),
        this.prisma.productSpecialty.createMany({ data: input.specialtyIds.map((specialtyId) => ({ productId: p.id, specialtyId })) }),
        ...order.map((mid, i) => this.prisma.productMedia.update({ where: { id: mid }, data: { position: i, isMain: mid === mainId } })),
      ]);
      await this.media.deleteMedia(p.media.filter((m) => !order.includes(m.id)).map((m) => m.id));
    } else {
      const live: RevisionData = {
        ...pickText(p),
        specialtyIds: p.specialties.map((s) => s.specialtyId).sort(),
        media: { order: p.media.filter((m) => m.approved).map((m) => m.id), mainId: p.media.find((m) => m.isMain && m.approved)?.id ?? null, removed: [] },
      };
      const next: RevisionData = {
        ...pickText(textData(input)),
        specialtyIds: [...input.specialtyIds].sort(),
        media: { order, mainId, removed: p.media.filter((m) => !order.includes(m.id)).map((m) => m.id) },
      };
      const changed =
        TEXT_FIELDS.some((f) => (live[f] ?? '') !== (next[f] ?? '')) ||
        live.specialtyIds.join() !== next.specialtyIds.join() ||
        live.media.order.join() !== next.media.order.join() ||
        live.media.mainId !== next.media.mainId;
      await this.prisma.productRevision.deleteMany({ where: { productId: p.id, status: { in: ['pending', 'rejected'] } } });
      if (changed) {
        await this.prisma.productRevision.create({ data: { productId: p.id, data: next as unknown as Prisma.InputJsonValue } });
        if (p.source !== 'manual') await this.prisma.product.update({ where: { id: p.id }, data: { manualOverride: true } });
      } else {
        // Правки отменены: неодобренные медиа, которых нет в живой версии, удаляем.
        await this.media.deleteMedia(p.media.filter((m) => !m.approved).map((m) => m.id));
      }
    }
    await this.prisma.product.update({ where: { id: p.id }, data: { updatedAt: new Date() } });
    await this.audit.log(actor.id, 'product.save', 'product', p.id);
    return this.get(supplier.id, p.id);
  }

  private async syncVariants(productId: string, variants: VariantInput[]) {
    const skus = variants.map((v) => v.sku.toLowerCase());
    const dup = skus.find((s, i) => skus.indexOf(s) !== i);
    if (dup) throw new BadRequestException({ message: `SKU ${dup} повторяется`, errors: { variants: `SKU ${dup} повторяется` } });
    const existing = await this.prisma.productVariant.findMany({ where: { productId } });
    const keep = new Set(variants.map((v) => v.id).filter(Boolean));
    try {
      await this.prisma.$transaction([
        this.prisma.productVariant.deleteMany({ where: { productId, id: { notIn: [...keep] as string[] } } }),
        ...variants.map((v) => {
          const data = {
            sku: v.sku,
            size: v.size,
            heightRange: v.heightRange || null,
            colorId: v.colorId,
            price: toKopecks(v.price),
            oldPrice: v.oldPrice ? toKopecks(v.oldPrice) : null,
            stock: v.stock,
            weightG: v.weightG,
            lengthMm: v.lengthMm,
            widthMm: v.widthMm,
            heightMm: v.heightMm,
          };
          return v.id && existing.some((e) => e.id === v.id)
            ? this.prisma.productVariant.update({ where: { id: v.id }, data })
            : this.prisma.productVariant.create({ data: { ...data, productId } });
        }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ message: 'SKU уже используется в этом товаре', errors: { variants: 'SKU повторяется' } });
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BadRequestException({ message: 'Выбран несуществующий цвет', errors: { variants: 'Проверьте цвет' } });
      }
      throw e;
    }
  }

  async submit(supplier: Supplier, id: string, actor: User) {
    const p = await this.load(supplier.id, id);
    if (p.moderationStatus !== 'draft' && p.moderationStatus !== 'rejected') {
      throw new BadRequestException({ message: 'Отправить на модерацию можно черновик или отклонённый товар' });
    }
    const problems: string[] = [];
    const photos = p.media.filter((m) => m.type === 'photo').length;
    if (photos < MIN_PHOTOS) problems.push(`нужно минимум ${MIN_PHOTOS} фото (сейчас ${photos})`);
    if (!p.variants.length) problems.push('добавьте хотя бы один вариант с ценой и остатком');
    if (!p.description?.trim()) problems.push('добавьте описание');
    if (problems.length) throw new BadRequestException({ message: `Нельзя отправить на модерацию: ${problems.join('; ')}` });
    await this.prisma.product.update({ where: { id }, data: { moderationStatus: 'pending', submittedAt: new Date(), rejectReason: null } });
    await this.audit.log(actor.id, 'product.submit', 'product', id);
    return this.get(supplier.id, id);
  }

  async setHidden(supplier: Supplier, id: string, hidden: boolean, actor: User) {
    const p = await this.load(supplier.id, id);
    const from = hidden ? 'published' : 'hidden';
    if (p.moderationStatus !== from) throw new BadRequestException({ message: hidden ? 'Снять с витрины можно только опубликованный товар' : 'Товар не снят с витрины' });
    await this.prisma.product.update({ where: { id }, data: { moderationStatus: hidden ? 'hidden' : 'published' } });
    await this.audit.log(actor.id, hidden ? 'product.hide' : 'product.unhide', 'product', id);
    return this.get(supplier.id, id);
  }

  async bulkHide(supplier: Supplier, ids: string[], actor: User) {
    const res = await this.prisma.product.updateMany({ where: { id: { in: ids }, supplierId: supplier.id, moderationStatus: 'published' }, data: { moderationStatus: 'hidden' } });
    await this.audit.log(actor.id, 'product.bulk_hide', 'supplier', supplier.id, { ids });
    return { hidden: res.count };
  }

  async remove(supplier: Supplier, id: string, actor: User) {
    const p = await this.load(supplier.id, id);
    if (p.publishedAt) throw new BadRequestException({ message: 'Товар уже был на витрине — его можно только снять с витрины' });
    await this.media.deleteMedia(p.media.map((m) => m.id));
    await this.prisma.product.delete({ where: { id } });
    await this.audit.log(actor.id, 'product.delete', 'product', id);
  }

  async addMedia(supplier: Supplier, id: string, file: { buffer: Buffer; mimetype: string }) {
    await this.load(supplier.id, id);
    if (file.mimetype === 'video/mp4') await this.media.addVideo(id, file.buffer);
    else if (/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.mimetype)) await this.media.addPhoto(id, file.buffer);
    else throw new BadRequestException({ message: 'Поддерживаются фото JPG, PNG, WebP, HEIC и видео mp4' });
    return this.get(supplier.id, id);
  }

  async exportCsv(supplierId: string): Promise<string> {
    const rows = await this.prisma.productVariant.findMany({
      where: { product: { supplierId } },
      include: { product: { include: { brand: true, category: true } }, color: true },
      orderBy: [{ product: { title: 'asc' } }, { sku: 'asc' }],
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['external_id', 'title', 'brand', 'category', 'sku', 'size', 'height_range', 'color', 'price', 'old_price', 'stock', 'status'];
    const lines = rows.map((v) =>
      [v.product.externalId, v.product.title, v.product.brand.name, v.product.category.name, v.sku, v.size, v.heightRange, v.color.name, toRubles(v.price), v.oldPrice == null ? '' : toRubles(v.oldPrice), v.stock, v.product.moderationStatus]
        .map(esc)
        .join(';'),
    );
    return '﻿' + [head.join(';'), ...lines].join('\r\n');
  }
}

export function pickText(src: TextFields): TextFields {
  return {
    title: src.title,
    brandId: src.brandId,
    categoryId: src.categoryId,
    gender: src.gender,
    fabric: src.fabric ?? '',
    treatment: src.treatment ?? '',
    washing: src.washing ?? '',
    description: src.description ?? '',
  };
}

function textData(input: Pick<ProductSaveInput, 'title' | 'brandId' | 'categoryId' | 'gender' | 'fabric' | 'treatment' | 'washing' | 'description'>): TextFields {
  return {
    title: input.title,
    brandId: input.brandId,
    categoryId: input.categoryId,
    gender: input.gender,
    fabric: input.fabric || null,
    treatment: input.treatment || null,
    washing: input.washing || null,
    description: input.description || null,
  };
}
