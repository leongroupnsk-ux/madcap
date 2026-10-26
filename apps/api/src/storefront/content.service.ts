import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ArticleSaveInput, CollectionSaveInput } from '@aesculap/shared';
import type { Article, Collection, Supplier, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { AuditService } from '../common/audit.service';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { shortId, slugify } from '../common/slug';
import { StorageService } from '../common/storage.service';
import { ThumbsService } from '../common/thumbs.service';
import { config } from '../config';
import { CatalogService, visibleWhere } from './catalog.service';

/** Белый список HTML для статей (ТЗ §7.6): заголовки, абзацы, списки, выделение, ссылки, картинки из нашего хранилища. */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a', 'br', 'img', 'blockquote'],
    allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: [] },
    exclusiveFilter: (frame) => frame.tag === 'img' && !String(frame.attribs.src ?? '').startsWith('/api/files/content/'),
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener', target: '_blank' }), b: 'strong', i: 'em' },
  }).trim();
}

const plain = (html: string) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

type Kind = 'article' | 'collection';

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly thumbs: ThumbsService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── обложки ─────────────────────────────────────────────────────────

  async uploadImage(file: { buffer: Buffer; mimetype: string }) {
    if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.mimetype)) throw new BadRequestException({ message: 'Нужно изображение JPG, PNG или WebP' });
    let data: Buffer;
    try {
      data = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException({ message: 'Файл не похож на изображение' });
    }
    const key = `public/content/${randomUUID()}.webp`;
    await this.storage.put(key, data);
    await this.thumbs.ensureCover(key, data);
    return { key, url: this.storage.publicUrl(key) };
  }

  // ─── кабинет поставщика ──────────────────────────────────────────────

  /** owner — id поставщика или null для редакции площадки */
  async supplierList(supplierId: string | null) {
    const [articles, collections] = await Promise.all([
      this.prisma.article.findMany({ where: { supplierId }, include: { _count: { select: { products: true } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.collection.findMany({ where: { supplierId }, include: { _count: { select: { products: true } } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return [
      ...articles.map((a) => ({ kind: 'article' as const, id: a.id, title: a.title, status: a.status, rejectReason: a.rejectReason, products: a._count.products, blocks: (a.body.match(/<(p|h2|h3|ul|ol)\b/g) ?? []).length, updatedAt: a.updatedAt })),
      ...collections.map((c) => ({ kind: 'collection' as const, id: c.id, title: c.title, status: c.status, rejectReason: c.rejectReason, products: c._count.products, blocks: 0, updatedAt: c.updatedAt })),
    ].sort((a, b) => +b.updatedAt - +a.updatedAt);
  }

  /** Поставщик привязывает только свои товары, редакция — любые опубликованные */
  private async ownProducts(supplierId: string | null, ids: string[]) {
    const own = await this.prisma.product.count({ where: { id: { in: ids }, ...(supplierId ? { supplierId } : { moderationStatus: 'published' }) } });
    if (own !== new Set(ids).size) throw new BadRequestException({ message: supplierId ? 'Можно привязать только свои товары' : 'Можно привязать только опубликованные товары' });
  }

  async getArticle(supplierId: string | null, id: string) {
    const a = await this.prisma.article.findFirst({ where: { id, supplierId }, include: { products: { orderBy: { position: 'asc' } } } });
    if (!a) throw new NotFoundException();
    return { id: a.id, title: a.title, lead: a.lead ?? '', coverKey: a.coverKey, coverUrl: this.storage.publicUrl(a.coverKey), body: a.body, status: a.status, rejectReason: a.rejectReason, productIds: a.products.map((p) => p.productId), slug: a.slug };
  }

  async getCollection(supplierId: string | null, id: string) {
    const c = await this.prisma.collection.findFirst({ where: { id, supplierId }, include: { products: { orderBy: { position: 'asc' } } } });
    if (!c) throw new NotFoundException();
    return { id: c.id, title: c.title, description: c.description ?? '', coverKey: c.coverKey, coverUrl: this.storage.publicUrl(c.coverKey), status: c.status, rejectReason: c.rejectReason, productIds: c.products.map((p) => p.productId), slug: c.slug };
  }

  /** Правка опубликованного материала снова отправляет его на модерацию — так проще, чем ревизии, и статей мало. */
  async saveArticle(owner: string | null, id: string | null, input: ArticleSaveInput, actor: User) {
    await this.ownProducts(owner, input.productIds);
    const data = { title: input.title, lead: input.lead || null, coverKey: input.coverKey, body: cleanHtml(input.body) };
    let article: Article;
    if (!id) {
      article = await this.prisma.article.create({ data: { ...data, supplierId: owner, slug: `${slugify(input.title) || 'statya'}-${shortId()}` } });
    } else {
      const current = await this.prisma.article.findFirst({ where: { id, supplierId: owner } });
      if (!current) throw new NotFoundException();
      // Правка опубликованного у поставщика — снова на модерацию; редакция правит без модерации
      article = await this.prisma.article.update({ where: { id }, data: { ...data, ...(owner && current.status === 'published' ? { status: 'pending', submittedAt: new Date() } : {}) } });
    }
    await this.prisma.articleProduct.deleteMany({ where: { articleId: article.id } });
    await this.prisma.articleProduct.createMany({ data: input.productIds.map((productId, position) => ({ articleId: article.id, productId, position })) });
    await this.audit.log(actor.id, 'content.article.save', 'article', article.id);
    return this.getArticle(owner, article.id);
  }

  async saveCollection(owner: string | null, id: string | null, input: CollectionSaveInput, actor: User) {
    await this.ownProducts(owner, input.productIds);
    const data = { title: input.title, description: input.description || null, coverKey: input.coverKey };
    let collection: Collection;
    if (!id) {
      collection = await this.prisma.collection.create({ data: { ...data, supplierId: owner, slug: `${slugify(input.title) || 'podborka'}-${shortId()}` } });
    } else {
      const current = await this.prisma.collection.findFirst({ where: { id, supplierId: owner } });
      if (!current) throw new NotFoundException();
      collection = await this.prisma.collection.update({ where: { id }, data: { ...data, ...(owner && current.status === 'published' ? { status: 'pending', submittedAt: new Date() } : {}) } });
    }
    await this.prisma.collectionProduct.deleteMany({ where: { collectionId: collection.id } });
    await this.prisma.collectionProduct.createMany({ data: input.productIds.map((productId, position) => ({ collectionId: collection.id, productId, position })) });
    await this.audit.log(actor.id, 'content.collection.save', 'collection', collection.id);
    return this.getCollection(owner, collection.id);
  }

  /** Требования к материалу перед публикацией — одинаковые для поставщика и редакции */
  private async ready(owner: string | null, kind: Kind, id: string) {
    if (kind === 'article') {
      const a = await this.prisma.article.findFirst({ where: { id, supplierId: owner } });
      if (!a) throw new NotFoundException();
      if (plain(a.body).length < 200) throw new BadRequestException({ message: 'Статья слишком короткая: нужно хотя бы 200 символов текста' });
      if (!a.coverKey) throw new BadRequestException({ message: 'Добавьте обложку' });
    } else {
      const c = await this.prisma.collection.findFirst({ where: { id, supplierId: owner }, include: { _count: { select: { products: true } } } });
      if (!c) throw new NotFoundException();
      if (c._count.products < 3) throw new BadRequestException({ message: 'В подборке должно быть хотя бы 3 товара' });
      if (!c.coverKey) throw new BadRequestException({ message: 'Добавьте обложку' });
    }
  }

  async submit(supplier: Supplier, kind: Kind, id: string, actor: User) {
    await this.ready(supplier.id, kind, id);
    const data = { status: 'pending' as const, submittedAt: new Date(), rejectReason: null };
    if (kind === 'article') await this.prisma.article.update({ where: { id }, data });
    else await this.prisma.collection.update({ where: { id }, data });
    await this.audit.log(actor.id, `content.${kind}.submit`, kind, id);
  }

  /** Редакция площадки публикует сама, без модерации (ТЗ §8: «статьи редакции») */
  async publishEditorial(kind: Kind, id: string, publish: boolean, actor: User) {
    if (publish) await this.ready(null, kind, id);
    const data = publish ? { status: 'published' as const, publishedAt: new Date(), rejectReason: null } : { status: 'draft' as const };
    const res = kind === 'article' ? await this.prisma.article.updateMany({ where: { id, supplierId: null }, data }) : await this.prisma.collection.updateMany({ where: { id, supplierId: null }, data });
    if (!res.count) throw new NotFoundException();
    await this.audit.log(actor.id, `content.editorial.${publish ? 'publish' : 'unpublish'}`, kind, id);
    return kind === 'article' ? this.getArticle(null, id) : this.getCollection(null, id);
  }

  async remove(owner: string | null, kind: Kind, id: string) {
    const res = kind === 'article'
      ? await this.prisma.article.deleteMany({ where: { id, supplierId: owner } })
      : await this.prisma.collection.deleteMany({ where: { id, supplierId: owner } });
    if (!res.count) throw new NotFoundException();
  }

  // ─── модерация ───────────────────────────────────────────────────────

  async queue() {
    const [articles, collections] = await Promise.all([
      this.prisma.article.findMany({ where: { status: 'pending' }, include: { supplier: true }, orderBy: { submittedAt: 'asc' } }),
      this.prisma.collection.findMany({ where: { status: 'pending' }, include: { supplier: true }, orderBy: { submittedAt: 'asc' } }),
    ]);
    return [
      ...articles.map((a) => ({ kind: 'article' as const, id: a.id, title: a.title, supplier: a.supplier?.legalName ?? 'Редакция', since: a.submittedAt ?? a.updatedAt })),
      ...collections.map((c) => ({ kind: 'collection' as const, id: c.id, title: c.title, supplier: c.supplier?.legalName ?? 'Редакция', since: c.submittedAt ?? c.updatedAt })),
    ];
  }

  async adminPreview(kind: Kind, id: string) {
    const item = kind === 'article'
      ? await this.prisma.article.findUnique({ where: { id }, include: { supplier: true, products: { orderBy: { position: 'asc' } } } })
      : await this.prisma.collection.findUnique({ where: { id }, include: { supplier: true, products: { orderBy: { position: 'asc' } } } });
    if (!item) throw new NotFoundException();
    const ids = item.products.map((p) => p.productId);
    const products = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, moderationStatus: true } });
    return {
      kind,
      id: item.id,
      title: item.title,
      status: item.status,
      supplier: item.supplier?.legalName ?? 'Редакция',
      coverUrl: this.storage.publicUrl(item.coverKey),
      lead: 'lead' in item ? item.lead : null,
      body: 'body' in item ? item.body : null,
      description: 'description' in item ? item.description : null,
      products: ids.map((pid) => products.find((p) => p.id === pid)).filter((p) => p !== undefined),
    };
  }

  async decide(kind: Kind, id: string, approve: boolean, reason: string | null, admin: User) {
    const where = { id, status: 'pending' as const };
    const data = approve ? { status: 'published' as const, publishedAt: new Date(), rejectReason: null } : { status: 'rejected' as const, rejectReason: reason };
    const res = kind === 'article' ? await this.prisma.article.updateMany({ where, data }) : await this.prisma.collection.updateMany({ where, data });
    if (!res.count) throw new BadRequestException({ message: 'Материал не ждёт модерации' });
    await this.audit.log(admin.id, `moderation.${kind}.${approve ? 'approve' : 'reject'}`, kind, id, { reason });
    const item = kind === 'article' ? await this.prisma.article.findUnique({ where: { id } }) : await this.prisma.collection.findUnique({ where: { id } });
    if (item?.supplierId) {
      await this.notifications.notify(item.supplierId, 'moderation', {
        title: approve ? `«${item.title}» опубликовано в журнале` : `«${item.title}» не прошло модерацию`,
        body: approve ? 'Материал виден в журнале.' : `Причина: ${reason}`,
        link: '/supplier/content',
      });
    }
  }

  // ─── витрина ─────────────────────────────────────────────────────────

  /** Лента журнала: статьи и подборки вместе, свежие сверху (ТЗ §4.6). */
  async journal() {
    const [articles, collections] = await Promise.all([
      this.prisma.article.findMany({ where: { status: 'published' }, include: { supplier: true }, orderBy: { publishedAt: 'desc' }, take: 60 }),
      this.prisma.collection.findMany({
        where: { status: 'published' },
        include: { supplier: true, products: { where: { product: visibleWhere() }, select: { productId: true } } },
        orderBy: { publishedAt: 'desc' },
        take: 60,
      }),
    ]);
    return [
      ...articles.map((a) => ({ kind: 'article' as const, slug: a.slug, title: a.title, lead: a.lead, author: a.supplier?.legalName ?? config.brandName, publishedAt: a.publishedAt!, coverUrl: this.storage.publicUrl(a.coverKey), cover: this.storage.imageSet(a.coverKey), count: 0 })),
      ...collections.map((c) => ({ kind: 'collection' as const, slug: c.slug, title: c.title, lead: c.description, author: c.supplier?.legalName ?? config.brandName, publishedAt: c.publishedAt!, coverUrl: this.storage.publicUrl(c.coverKey), cover: this.storage.imageSet(c.coverKey), count: c.products.length })),
    ].sort((a, b) => +b.publishedAt - +a.publishedAt);
  }

  async article(slug: string) {
    const a = await this.prisma.article.findFirst({ where: { slug, status: 'published' }, include: { supplier: true, products: { where: { product: visibleWhere() }, orderBy: { position: 'asc' } } } });
    if (!a) throw new NotFoundException({ message: 'Статья не найдена' });
    return {
      slug: a.slug,
      title: a.title,
      lead: a.lead,
      body: a.body,
      author: a.supplier?.legalName ?? config.brandName,
      publishedAt: a.publishedAt,
      updatedAt: a.updatedAt,
      coverUrl: this.storage.publicUrl(a.coverKey),
      cover: this.storage.imageSet(a.coverKey),
      products: await this.catalog.cards(a.products.map((p) => p.productId)),
    };
  }

  async collection(slug: string) {
    const c = await this.prisma.collection.findFirst({ where: { slug, status: 'published' }, include: { supplier: true, products: { where: { product: visibleWhere() }, orderBy: { position: 'asc' } } } });
    if (!c) throw new NotFoundException({ message: 'Подборка не найдена' });
    return {
      slug: c.slug,
      title: c.title,
      description: c.description,
      author: c.supplier?.legalName ?? config.brandName,
      publishedAt: c.publishedAt,
      coverUrl: this.storage.publicUrl(c.coverKey),
      cover: this.storage.imageSet(c.coverKey),
      products: await this.catalog.cards(c.products.map((p) => p.productId)),
    };
  }
}
