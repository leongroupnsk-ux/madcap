import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { salePriceOf, type PromotionInput } from '@aesculap/shared';
import type { Promotion, Supplier, User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { repriceSales } from './price';
import { slugify } from '../common/slug';
import { StorageService } from '../common/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY = 86400000;
const date = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/** Акции платформы (ТЗ §7.7, §8): заявки поставщиков, модерация, акционная цена и льготная комиссия. */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Пересчёт акционных цен у вариантов. Цена поставщика (price) не меняется — синк YML её
   * обновляет, а акционная цена пересчитывается от новой. Идёт каждую минуту и после изменений.
   */
  reprice() {
    return repriceSales(this.prisma);
  }

  private phase(p: Promotion, now = new Date()) {
    if (now >= p.endsAt) return 'finished' as const;
    if (now >= p.startsAt) return 'running' as const;
    if (now >= p.applyFrom && now <= p.applyTo) return 'applying' as const;
    return now < p.applyFrom ? ('scheduled' as const) : ('waiting' as const);
  }

  private view(p: Promotion) {
    return {
      id: p.id, name: p.name, slug: p.slug, description: p.description, badge: p.badge, minDiscountPct: p.minDiscountPct, commissionBp: p.commissionBp,
      applyFrom: p.applyFrom, applyTo: p.applyTo, startsAt: p.startsAt, endsAt: p.endsAt, onHomepage: p.onHomepage, newsletter: p.newsletter,
      requirements: p.requirements, phase: this.phase(p), acceptsApplications: new Date() >= p.applyFrom && new Date() <= p.applyTo,
    };
  }

  // ─── админка ─────────────────────────────────────────────────────────

  private data(input: PromotionInput) {
    const { commissionPct, ...rest } = input;
    return { ...rest, commissionBp: Math.round(commissionPct * 100) };
  }

  async create(input: PromotionInput, admin: User) {
    let slug = slugify(input.name) || 'akciya';
    if (await this.prisma.promotion.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
    const p = await this.prisma.promotion.create({ data: { ...this.data(input), slug } });
    await this.audit.log(admin.id, 'promotion.create', 'promotion', p.id, { name: p.name });
    const suppliers = await this.prisma.supplier.findMany({ where: { status: 'active' }, select: { id: true } });
    for (const s of suppliers) {
      await this.notifications.notify(s.id, 'promotion', {
        title: `Новая акция: ${p.name}`,
        body: `Скидка от ${p.minDiscountPct}%, комиссия ${p.commissionBp / 100}% на время акции. Приём заявок до ${date(p.applyTo)}, акция ${date(p.startsAt)} — ${date(p.endsAt)}.`,
        link: `/supplier/promotions/${p.id}`,
      });
    }
    return this.view(p);
  }

  async update(id: string, input: PromotionInput, admin: User) {
    const p = await this.prisma.promotion.update({ where: { id }, data: this.data(input) }).catch(() => null);
    if (!p) throw new NotFoundException();
    await this.audit.log(admin.id, 'promotion.update', 'promotion', id, {});
    await this.reprice();
    return this.view(p);
  }

  async adminList() {
    const rows = await this.prisma.promotion.findMany({ orderBy: { startsAt: 'desc' }, include: { _count: { select: { products: true } }, products: { where: { status: 'pending' }, select: { id: true } } } });
    return rows.map((p) => ({ ...this.view(p), applications: p._count.products, pending: p.products.length }));
  }

  async applications(status = 'pending') {
    const rows = await this.prisma.promotionProduct.findMany({
      where: { status: status as 'pending' },
      include: { promotion: true, supplier: true, product: { include: { variants: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => {
      const price = Math.min(...r.product.variants.map((v) => v.price));
      return {
        id: r.id, promotion: r.promotion.name, minDiscountPct: r.promotion.minDiscountPct, supplier: r.supplier.legalName, product: r.product.title, productId: r.productId,
        discountPct: r.discountPct, price, salePrice: salePriceOf(price, r.discountPct), createdAt: r.createdAt,
      };
    });
  }

  async decide(id: string, approve: boolean, reason: string | undefined, admin: User) {
    const r = await this.prisma.promotionProduct.findUnique({ where: { id }, include: { promotion: true, product: true } });
    if (!r) throw new NotFoundException();
    if (!approve && !reason) throw new BadRequestException({ message: 'Укажите причину', errors: { reason: 'Укажите причину' } });
    await this.prisma.promotionProduct.update({ where: { id }, data: { status: approve ? 'approved' : 'rejected', rejectReason: approve ? null : reason, decidedAt: new Date() } });
    await this.audit.log(admin.id, approve ? 'promotion.approve' : 'promotion.reject', 'promotion_product', id, { reason });
    await this.reprice();
    await this.notifications.notify(r.supplierId, 'moderation', {
      title: approve ? `${r.product.title} участвует в акции «${r.promotion.name}»` : `${r.product.title} не принят в акцию «${r.promotion.name}»`,
      body: approve ? `Скидка ${r.discountPct}% применится ${date(r.promotion.startsAt)} — ${date(r.promotion.endsAt)}.` : `Причина: ${reason}`,
      link: `/supplier/promotions/${r.promotionId}`,
    });
    return { ok: true };
  }

  // ─── поставщик ───────────────────────────────────────────────────────

  async supplierList(supplier: Supplier) {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({ where: { endsAt: { gt: new Date(now.getTime() - 30 * DAY) } }, orderBy: { startsAt: 'asc' } });
    const out = [];
    for (const p of rows) out.push({ ...this.view(p), stats: await this.stats(supplier, p) });
    return out;
  }

  private async stats(supplier: Supplier, p: Promotion) {
    const [products, pending, sold] = await Promise.all([
      this.prisma.promotionProduct.count({ where: { promotionId: p.id, supplierId: supplier.id, status: 'approved' } }),
      this.prisma.promotionProduct.count({ where: { promotionId: p.id, supplierId: supplier.id, status: 'pending' } }),
      this.prisma.shipmentItem.aggregate({
        where: { promotionId: p.id, shipment: { supplierId: supplier.id, paidAt: { gte: new Date(Date.now() - 7 * DAY) } } },
        _sum: { qty: true },
      }),
    ]);
    return { products, pending, soldWeek: sold._sum.qty ?? 0 };
  }

  /** Товары поставщика для таблицы «Товары в акции» (ТЗ §7.7). */
  async supplierProducts(supplier: Supplier, promotionId: string) {
    const p = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!p) throw new NotFoundException();
    const products = await this.prisma.product.findMany({
      where: { supplierId: supplier.id, moderationStatus: { in: ['published', 'pending'] } },
      include: { variants: true, promotions: { where: { promotionId } }, media: { where: { type: 'photo' }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }], take: 1 } },
      orderBy: { title: 'asc' },
    });
    return {
      promotion: { ...this.view(p), stats: await this.stats(supplier, p) },
      items: products.map((pr) => {
        const price = pr.variants.length ? Math.min(...pr.variants.map((v) => v.price)) : 0;
        const part = pr.promotions[0];
        const status = !part ? 'none' : part.discountPct < p.minDiscountPct ? 'below_min' : part.status;
        return {
          productId: pr.id, title: pr.title, sku: pr.variants[0]?.sku ?? '', thumbUrl: this.storage.publicUrl(pr.media[0]?.storageKey.replace(/\.webp$/, '_thumb.webp')),
          price, discountPct: part?.discountPct ?? null, salePrice: part ? salePriceOf(price, part.discountPct) : null, status, rejectReason: part?.rejectReason ?? null,
        };
      }),
    };
  }

  async apply(supplier: Supplier, promotionId: string, items: { productId: string; discountPct: number }[], actor: User) {
    const p = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!p) throw new NotFoundException();
    const now = new Date();
    if (now < p.applyFrom || now > p.applyTo) throw new BadRequestException({ message: `Приём заявок ${now < p.applyFrom ? `откроется ${date(p.applyFrom)}` : 'закончился'}` });
    const errors: Record<string, string> = {};
    for (const i of items) if (i.discountPct < p.minDiscountPct) errors[i.productId] = `Скидка меньше минимальной (${p.minDiscountPct}%)`;
    if (Object.keys(errors).length) throw new BadRequestException({ message: `Минимальная скидка в акции — ${p.minDiscountPct}%`, errors });
    const own = await this.prisma.product.count({ where: { id: { in: items.map((i) => i.productId) }, supplierId: supplier.id } });
    if (own !== new Set(items.map((i) => i.productId)).size) throw new NotFoundException({ message: 'Товар не найден' });
    for (const i of items) {
      // Изменение скидки снова отправляет заявку на модерацию.
      await this.prisma.promotionProduct.upsert({
        where: { promotionId_productId: { promotionId, productId: i.productId } },
        update: { discountPct: i.discountPct, status: 'pending', rejectReason: null, decidedAt: null },
        create: { promotionId, productId: i.productId, supplierId: supplier.id, discountPct: i.discountPct },
      });
    }
    await this.audit.log(actor.id, 'promotion.apply', 'promotion', promotionId, { count: items.length });
    await this.reprice();
    return this.supplierProducts(supplier, promotionId);
  }

  async withdraw(supplier: Supplier, promotionId: string, productId: string, actor: User) {
    const r = await this.prisma.promotionProduct.deleteMany({ where: { promotionId, productId, supplierId: supplier.id } });
    if (!r.count) throw new ConflictException({ message: 'Товар не участвует в акции' });
    await this.audit.log(actor.id, 'promotion.withdraw', 'promotion', promotionId, { productId });
    await this.reprice();
    return this.supplierProducts(supplier, promotionId);
  }

  // ─── витрина ─────────────────────────────────────────────────────────

  /** Идущие акции для главной (ТЗ §7.7: «раздел на главной») */
  async active() {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({ where: { startsAt: { lte: now }, endsAt: { gt: now }, onHomepage: true }, orderBy: { endsAt: 'asc' } });
    return rows.map((p) => ({ id: p.id, slug: p.slug, name: p.name, badge: p.badge, description: p.description, endsAt: p.endsAt, label: `до ${date(p.endsAt)}` }));
  }

}
