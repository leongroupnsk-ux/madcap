import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { REVIEW_MAX_PHOTOS, type ReviewCreateInput, type ReviewSaveInput } from '@aesculap/shared';
import type { Prisma, Review, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AuditService } from '../common/audit.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { StorageService } from '../common/storage.service';
import { ThumbsService } from '../common/thumbs.service';
import { photoVariantKeys } from '../common/image-keys';
import { config } from '../config';
import { NotificationsService } from '../notifications/notifications.service';
import { catalogChanged } from '../storefront/catalog-cache';

/** Загруженное, но ещё не привязанное к отзыву фото принадлежит загрузившему сутки (ключ в Redis) */
const PHOTO_OWNER_TTL = 86400;
const photoOwnerKey = (key: string) => `review-photo:${key}`;
const PHOTO_KEY = /^public\/reviews\/[0-9a-f-]{36}\.webp$/;

/** Имя на витрине: первое слово имени из анкеты, иначе «Покупатель» */
export const ANONYMOUS_AUTHOR = 'Покупатель';
const authorOf = (name: string | null | undefined) => name?.trim().split(/\s+/)[0]?.slice(0, 40) || ANONYMOUS_AUTHOR;

/**
 * Отзывы покупателей (запись): оставить можно только по доставленной позиции, один на товар; новый и
 * отредактированный отзыв уходит на модерацию (область «Модерация»). Ответ продавца публикуется сразу.
 * Чтение для витрины — в CatalogService (там же кэш сводки).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly thumbs: ThumbsService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly mail: MailTemplatesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── право на отзыв ──────────────────────────────────────────────────

  /** Позиции покупателя в доставленных отправлениях, возвращённые не целиком */
  private deliveredItems(userId: string): Prisma.ShipmentItemWhereInput {
    return { shipment: { status: 'delivered', order: { userId } }, returnedQty: { lt: this.prisma.shipmentItem.fields.qty } };
  }

  async canReview(userId: string, product: { id: string; slug: string }) {
    const n = await this.prisma.shipmentItem.count({
      where: { AND: [this.deliveredItems(userId), { OR: [{ variant: { productId: product.id } }, { productSlug: product.slug }] }] },
    });
    return n > 0;
  }

  /** Товары, на которые покупатель может оставить отзыв: по доставленным позициям (вариант мог быть удалён — тогда по слагу) */
  private async eligibleProducts(userId: string) {
    const items = await this.prisma.shipmentItem.findMany({ where: this.deliveredItems(userId), select: { productSlug: true, variant: { select: { productId: true } } } });
    const ids = [...new Set(items.map((i) => i.variant?.productId).filter((x): x is string => Boolean(x)))];
    const slugs = [...new Set(items.filter((i) => !i.variant && i.productSlug).map((i) => i.productSlug!))];
    if (!ids.length && !slugs.length) return [];
    return this.prisma.product.findMany({ where: { OR: [{ id: { in: ids } }, { slug: { in: slugs } }] }, select: { id: true, slug: true, title: true } });
  }

  // ─── фото ────────────────────────────────────────────────────────────

  /** Фото к отзыву: как обложки контента — поворот по EXIF, WebP до 1600 px; метаданные (EXIF, геометки) sharp не переносит */
  async uploadPhoto(user: User, file: { buffer: Buffer; mimetype: string }) {
    if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.mimetype)) throw new BadRequestException({ message: 'Нужно изображение JPG, PNG или WebP' });
    let data: Buffer;
    try {
      data = await sharp(file.buffer, { failOn: 'error' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException({ message: 'Файл не похож на изображение' });
    }
    const key = `public/reviews/${randomUUID()}.webp`;
    await this.storage.put(key, data);
    await this.thumbs.ensureCover(key, data);
    await this.redis.client.set(photoOwnerKey(key), user.id, 'EX', PHOTO_OWNER_TTL);
    return { key, url: this.storage.publicUrl(key), image: this.storage.imageSet(key) };
  }

  /** Фото отзыва — только свои: уже прикреплённые к этому отзыву или только что загруженные этим покупателем */
  private async checkPhotos(userId: string, keys: string[], current: string[] = []) {
    const unique = [...new Set(keys)];
    if (unique.length > REVIEW_MAX_PHOTOS) throw new BadRequestException({ message: `Не больше ${REVIEW_MAX_PHOTOS} фото` });
    for (const key of unique) {
      if (current.includes(key)) continue;
      if (!PHOTO_KEY.test(key) || (await this.redis.client.get(photoOwnerKey(key))) !== userId) throw new BadRequestException({ message: 'Фото не найдено — загрузите его заново' });
    }
    return unique;
  }

  private async removePhotos(keys: string[]) {
    for (const key of keys) for (const k of [key, ...photoVariantKeys(key)]) await this.storage.remove(k).catch(() => undefined);
  }

  // ─── покупатель ──────────────────────────────────────────────────────

  private view(r: Review & { product: { slug: string; title: string } }) {
    return {
      id: r.id,
      productId: r.productId,
      product: { slug: r.product.slug, title: r.product.title },
      rating: r.rating,
      fit: r.fit,
      text: r.text,
      photos: r.photos.map((key) => ({ key, url: this.storage.publicUrl(key), image: this.storage.imageSet(key) })),
      status: r.status,
      rejectReason: r.rejectReason,
      reply: r.reply,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** Мои отзывы со статусом модерации и товары, на которые ещё можно написать отзыв */
  async mine(user: User) {
    const [reviews, eligible] = await Promise.all([
      this.prisma.review.findMany({ where: { userId: user.id }, include: { product: { select: { slug: true, title: true } } }, orderBy: { updatedAt: 'desc' } }),
      this.eligibleProducts(user.id),
    ]);
    const reviewed = new Set(reviews.map((r) => r.productId));
    return { reviews: reviews.map((r) => this.view(r)), eligible: eligible.filter((p) => !reviewed.has(p.id)) };
  }

  /** Для страницы товара: можно ли написать отзыв и мой отзыв, если он есть */
  async forProduct(user: User, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, slug: true } });
    if (!product) throw new NotFoundException();
    const review = await this.prisma.review.findUnique({ where: { productId_userId: { productId, userId: user.id } }, include: { product: { select: { slug: true, title: true } } } });
    return { canReview: !review && (await this.canReview(user.id, product)), review: review && this.view(review) };
  }

  async create(user: User, input: ReviewCreateInput) {
    if (user.role !== 'buyer') throw new ForbiddenException({ message: 'Отзывы оставляют покупатели' });
    const product = await this.prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, slug: true, title: true } });
    if (!product) throw new NotFoundException({ message: 'Товар не найден' });
    if (!(await this.canReview(user.id, product))) throw new ForbiddenException({ message: 'Отзыв можно оставить после получения заказа с этим товаром' });
    if (await this.prisma.review.findUnique({ where: { productId_userId: { productId: product.id, userId: user.id } } })) {
      throw new ConflictException({ message: 'Вы уже оставили отзыв на этот товар — его можно отредактировать в профиле' });
    }
    const photos = await this.checkPhotos(user.id, input.photos);
    const profile = await this.prisma.buyerProfile.findUnique({ where: { userId: user.id }, select: { name: true } });
    let review;
    try {
      review = await this.prisma.review.create({
        data: { productId: product.id, userId: user.id, authorName: authorOf(profile?.name), rating: input.rating, fit: input.fit, text: input.text, photos },
        include: { product: { select: { slug: true, title: true } } },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ message: 'Вы уже оставили отзыв на этот товар' });
      throw e;
    }
    if (photos.length) await this.redis.client.del(...photos.map(photoOwnerKey)).catch(() => undefined);
    await this.audit.log(user.id, 'review.create', 'review', review.id, { productId: product.id });
    return this.view(review);
  }

  /** Правка своего отзыва — снова на модерацию; чужой отзыв для покупателя не существует (404) */
  async update(user: User, id: string, input: ReviewSaveInput) {
    const current = await this.prisma.review.findFirst({ where: { id, userId: user.id } });
    if (!current) throw new NotFoundException({ message: 'Отзыв не найден' });
    const photos = await this.checkPhotos(user.id, input.photos, current.photos);
    const review = await this.prisma.review.update({
      where: { id },
      data: { rating: input.rating, fit: input.fit, text: input.text, photos, status: 'pending', rejectReason: null, moderatedAt: null, moderatedById: null },
      include: { product: { select: { slug: true, title: true } } },
    });
    await this.removePhotos(current.photos.filter((k) => !photos.includes(k)));
    if (photos.length) await this.redis.client.del(...photos.map(photoOwnerKey)).catch(() => undefined);
    await this.audit.log(user.id, 'review.update', 'review', id, { productId: current.productId });
    // Опубликованный отзыв снят до повторной модерации — сводка оценок на витрине меняется
    if (current.status === 'approved') await catalogChanged(this.redis);
    return this.view(review);
  }

  async remove(user: User, id: string) {
    const current = await this.prisma.review.findFirst({ where: { id, userId: user.id } });
    if (!current) throw new NotFoundException({ message: 'Отзыв не найден' });
    await this.prisma.review.delete({ where: { id } });
    await this.removePhotos(current.photos);
    await this.audit.log(user.id, 'review.delete', 'review', id, { productId: current.productId });
    if (current.status === 'approved') await catalogChanged(this.redis);
    return { ok: true };
  }

  // ─── модерация ───────────────────────────────────────────────────────

  async queue(status: 'pending' | 'approved' | 'rejected') {
    const [rows, counts] = await Promise.all([
      this.prisma.review.findMany({
        where: { status },
        include: { product: { select: { slug: true, title: true, supplier: { select: { legalName: true } } } } },
        orderBy: { updatedAt: status === 'pending' ? 'asc' : 'desc' },
        take: 100,
      }),
      this.prisma.review.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
      items: rows.map((r) => ({
        id: r.id,
        product: { slug: r.product.slug, title: r.product.title },
        supplier: r.product.supplier.legalName,
        author: r.authorName,
        rating: r.rating,
        fit: r.fit,
        text: r.text,
        photos: r.photos.map((key) => ({ url: this.storage.publicUrl(key), image: this.storage.imageSet(key) })),
        status: r.status,
        rejectReason: r.rejectReason,
        reply: r.reply,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  async decide(id: string, approve: boolean, reason: string | null, admin: User) {
    const r = await this.prisma.review.findUnique({ where: { id }, include: { product: { select: { title: true, supplierId: true } }, user: { select: { email: true, deletedAt: true } } } });
    if (!r) throw new NotFoundException();
    const now = new Date();
    // Одобрить — из очереди или отклонённый; отклонить — из очереди или снять опубликованный
    const moved = await this.prisma.review.updateMany({
      where: { id, status: approve ? { in: ['pending', 'rejected'] } : { in: ['pending', 'approved'] }, updatedAt: r.updatedAt },
      data: approve
        ? { status: 'approved', rejectReason: null, moderatedAt: now, moderatedById: admin.id, publishedAt: r.publishedAt ?? now }
        : { status: 'rejected', rejectReason: reason, moderatedAt: now, moderatedById: admin.id },
    });
    if (!moved.count) throw new ConflictException({ message: 'Отзыв уже рассмотрен или изменён — обновите страницу' });
    // moderation.review.* сбрасывает кэш каталога (AuditService): меняются средняя оценка и число отзывов
    await this.audit.log(admin.id, approve ? 'moderation.review.approve' : 'moderation.review.reject', 'review', id, { productId: r.productId, ...(reason ? { reason } : {}) });
    // Поставщику — о новом опубликованном отзыве (первая публикация; повторное одобрение после правки — не новый отзыв)
    if (approve && !r.publishedAt) {
      await this.notifications.notify(r.product.supplierId, 'review', {
        title: `Новый отзыв на «${r.product.title}»: ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}`,
        body: `${r.authorName}: ${r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text}\nОтветить можно в карточке товара — ответ публикуется сразу.`,
        link: `/supplier/products/${r.productId}`,
      });
    }
    if (!approve && !r.user.deletedAt) {
      await this.mail
        .send('review.rejected', r.user.email, { 'product.title': r.product.title, reason, profileUrl: `${config.webOrigin}/account#reviews` })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  // ─── поставщик ───────────────────────────────────────────────────────

  private async ownProduct(supplierId: string, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, supplierId }, select: { id: true } });
    if (!p) throw new NotFoundException({ message: 'Товар не найден' });
  }

  /** Одобренные отзывы на свой товар (только чтение) и сводка */
  async supplierList(supplierId: string, productId: string) {
    await this.ownProduct(supplierId, productId);
    const rows = await this.prisma.review.findMany({ where: { productId, status: 'approved' }, orderBy: { publishedAt: 'desc' }, take: 200 });
    const count = rows.length;
    return {
      count,
      avg: count ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null,
      items: rows.map((r) => ({
        id: r.id, author: r.authorName, rating: r.rating, fit: r.fit, text: r.text, publishedAt: r.publishedAt,
        photos: r.photos.map((key) => ({ url: this.storage.publicUrl(key), image: this.storage.imageSet(key) })),
        reply: r.reply, replyAt: r.replyAt,
      })),
    };
  }

  /** Ответ продавца — один на отзыв, публикуется сразу (правка и удаление — через поддержку) */
  async reply(supplierId: string, productId: string, reviewId: string, text: string, actor: User) {
    await this.ownProduct(supplierId, productId);
    const r = await this.prisma.review.updateMany({ where: { id: reviewId, productId, status: 'approved', reply: null }, data: { reply: text, replyAt: new Date(), replyById: actor.id } });
    if (!r.count) {
      const exists = await this.prisma.review.findFirst({ where: { id: reviewId, productId, status: 'approved' } });
      if (!exists) throw new NotFoundException({ message: 'Отзыв не найден' });
      throw new ConflictException({ message: 'На этот отзыв уже есть ответ' });
    }
    await this.audit.log(actor.id, 'review.reply', 'review', reviewId, { productId, supplierId });
    return this.supplierList(supplierId, productId);
  }

  // ─── 152-ФЗ ──────────────────────────────────────────────────────────

  /** Удаление аккаунта: отзыв обезличивается («Покупатель»), текст остаётся; фото удаляются — на них может быть сам человек */
  async anonymize(userId: string) {
    const rows = await this.prisma.review.findMany({ where: { userId }, select: { id: true, photos: true, status: true } });
    if (!rows.length) return 0;
    await this.prisma.review.updateMany({ where: { userId }, data: { authorName: ANONYMOUS_AUTHOR, photos: [] } });
    await this.removePhotos(rows.flatMap((r) => r.photos));
    if (rows.some((r) => r.status === 'approved' && r.photos.length)) await catalogChanged(this.redis);
    return rows.length;
  }
}
