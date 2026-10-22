import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { toRubles } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { MediaService } from './media.service';
import { pickText, type RevisionData } from './products.service';

/** Очередь модерации товаров (ТЗ §8): первичная публикация и ревизии опубликованных. SLA 24 ч. */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async queue() {
    const [products, revisions] = await Promise.all([
      this.prisma.product.findMany({
        where: { moderationStatus: 'pending' },
        include: { supplier: { select: { legalName: true } } },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.productRevision.findMany({
        where: { status: 'pending' },
        include: { product: { include: { supplier: { select: { legalName: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return [
      ...products.map((p) => ({ kind: 'product' as const, id: p.id, productId: p.id, title: p.title, supplier: p.supplier.legalName, since: p.submittedAt ?? p.updatedAt })),
      ...revisions.map((r) => ({ kind: 'revision' as const, id: r.id, productId: r.productId, title: r.product.title, supplier: r.product.supplier.legalName, since: r.createdAt })),
    ].sort((a, b) => +a.since - +b.since);
  }

  /** Карточка для модератора: живая версия и (если есть) предлагаемая ревизия. */
  async details(productId: string) {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        supplier: { select: { legalName: true, inn: true } },
        brand: true,
        category: true,
        specialties: { include: { specialty: true } },
        variants: { include: { color: true }, orderBy: { sku: 'asc' } },
        media: { orderBy: { position: 'asc' } },
        revisions: { where: { status: 'pending' }, take: 1 },
      },
    });
    if (!p) throw new NotFoundException();
    const rev = p.revisions[0];
    const data = rev?.data as unknown as RevisionData | undefined;
    const [revBrand, revCategory, revSpecs] = data
      ? await Promise.all([
          this.prisma.brand.findUnique({ where: { id: data.brandId } }),
          this.prisma.category.findUnique({ where: { id: data.categoryId } }),
          this.prisma.specialty.findMany({ where: { id: { in: data.specialtyIds } } }),
        ])
      : [null, null, []];
    const mediaById = new Map(p.media.map((m) => [m.id, m]));
    return {
      id: p.id,
      status: p.moderationStatus,
      supplier: p.supplier,
      live: {
        ...pickText(p),
        brand: p.brand.name,
        category: p.category.name,
        specialties: p.specialties.map((s) => s.specialty.name),
        media: p.media.filter((m) => p.moderationStatus === 'pending' || m.approved).map((m) => this.media.view(m)),
      },
      revision: data
        ? {
            id: rev!.id,
            createdAt: rev!.createdAt,
            ...pickText(data),
            brand: revBrand?.name ?? '—',
            category: revCategory?.name ?? '—',
            specialties: revSpecs.map((s) => s.name),
            media: data.media.order.map((id) => mediaById.get(id)).filter((m) => m !== undefined).map((m) => ({ ...this.media.view(m), isMain: m.id === data.media.mainId })),
            removedMedia: data.media.removed.map((id) => mediaById.get(id)).filter((m) => m !== undefined).map((m) => this.media.view(m)),
          }
        : null,
      variants: p.variants.map((v) => ({ sku: v.sku, size: v.size, heightRange: v.heightRange, color: v.color.name, price: toRubles(v.price), oldPrice: v.oldPrice == null ? null : toRubles(v.oldPrice), stock: v.stock })),
    };
  }

  async approveProduct(id: string, admin: User) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || p.moderationStatus !== 'pending') throw new BadRequestException({ message: 'Товар не ждёт модерации' });
    await this.prisma.$transaction([
      this.prisma.product.update({ where: { id }, data: { moderationStatus: 'published', publishedAt: p.publishedAt ?? new Date(), rejectReason: null } }),
      this.prisma.productMedia.updateMany({ where: { productId: id }, data: { approved: true } }),
    ]);
    await this.audit.log(admin.id, 'moderation.product.approve', 'product', id);
    await this.notify(p.supplierId, `Товар «${p.title}» опубликован`, 'Товар прошёл модерацию и появился на витрине (если подключены выплаты).');
  }

  async rejectProduct(id: string, reason: string, admin: User) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || p.moderationStatus !== 'pending') throw new BadRequestException({ message: 'Товар не ждёт модерации' });
    await this.prisma.product.update({ where: { id }, data: { moderationStatus: 'rejected', rejectReason: reason } });
    await this.audit.log(admin.id, 'moderation.product.reject', 'product', id, { reason });
    await this.notify(p.supplierId, `Товар «${p.title}» не прошёл модерацию`, `Причина: ${reason}\nИсправьте карточку и отправьте снова.`);
  }

  async approveRevision(id: string, admin: User) {
    const rev = await this.prisma.productRevision.findUnique({ where: { id }, include: { product: { include: { media: true } } } });
    if (!rev || rev.status !== 'pending') throw new BadRequestException({ message: 'Правка не ждёт модерации' });
    const data = rev.data as unknown as RevisionData;
    const known = new Set(rev.product.media.map((m) => m.id));
    const order = data.media.order.filter((m) => known.has(m));
    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: rev.productId },
        data: {
          title: data.title,
          brandId: data.brandId,
          categoryId: data.categoryId,
          gender: data.gender,
          fabric: data.fabric || null,
          treatment: data.treatment || null,
          washing: data.washing || null,
          description: data.description || null,
        },
      }),
      this.prisma.productSpecialty.deleteMany({ where: { productId: rev.productId } }),
      this.prisma.productSpecialty.createMany({ data: data.specialtyIds.map((specialtyId) => ({ productId: rev.productId, specialtyId })) }),
      ...order.map((mid, i) => this.prisma.productMedia.update({ where: { id: mid }, data: { position: i, isMain: mid === data.media.mainId, approved: true } })),
      this.prisma.productRevision.update({ where: { id }, data: { status: 'approved', reviewedAt: new Date() } }),
    ]);
    await this.media.deleteMedia(data.media.removed.filter((m) => known.has(m)));
    await this.audit.log(admin.id, 'moderation.revision.approve', 'product', rev.productId, { revisionId: id });
    await this.notify(rev.product.supplierId, `Правки товара «${data.title}» опубликованы`, 'Изменения прошли модерацию и видны на витрине.');
  }

  async rejectRevision(id: string, reason: string, admin: User) {
    const rev = await this.prisma.productRevision.findUnique({ where: { id }, include: { product: true } });
    if (!rev || rev.status !== 'pending') throw new BadRequestException({ message: 'Правка не ждёт модерации' });
    await this.prisma.productRevision.update({ where: { id }, data: { status: 'rejected', rejectReason: reason, reviewedAt: new Date() } });
    // Новые файлы из отклонённой правки на витрину не попадут — удаляем.
    const unapproved = await this.prisma.productMedia.findMany({ where: { productId: rev.productId, approved: false }, select: { id: true } });
    await this.media.deleteMedia(unapproved.map((m) => m.id));
    await this.audit.log(admin.id, 'moderation.revision.reject', 'product', rev.productId, { revisionId: id, reason });
    await this.notify(rev.product.supplierId, `Правки товара «${rev.product.title}» отклонены`, `Причина: ${reason}\nНа витрине осталась прежняя версия.`);
  }

  /** Письмо владельцам поставщика; каналы и настройки событий — E5-02. */
  private async notify(supplierId: string, subject: string, text: string) {
    const owners = await this.prisma.supplierMember.findMany({ where: { supplierId, role: { in: ['owner', 'catalog'] } }, include: { user: true } });
    for (const o of owners) await this.mail.send({ to: o.user.email, subject: `${subject} — ${config.brandName}`, text: `${text}\n\n${config.webOrigin}/supplier/products` });
  }
}
