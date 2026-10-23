import { Injectable } from '@nestjs/common';
import type { CartLineInput } from '@aesculap/shared';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { shown } from '../promotions/price';
import { visibleWhere } from '../storefront/catalog.service';

export type CheckedLine = {
  variantId: string;
  qty: number;
  fromCapsule: boolean;
  available: boolean;
  stock: number;
  price: number;
  oldPrice: number | null;
  /** Акция, по которой продаётся вариант, и комиссия по позиции (льготная в акции) */
  promotionId: string | null;
  commissionBp: number;
  sku: string;
  size: string;
  heightRange: string | null;
  color: string;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  product: { id: string; slug: string; title: string; brand: string; image: string | null; imageKey: string | null };
  supplier: { id: string; name: string; city: string | null };
};

/** Корзина (ТЗ §6.1): у вошедшего хранится на сервере, проверка цен и остатков — при каждом открытии. */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async get(userId: string) {
    const rows = await this.prisma.cartItem.findMany({ where: { userId }, orderBy: { updatedAt: 'asc' } });
    return { lines: rows.map((r) => ({ variantId: r.variantId, qty: r.qty, fromCapsule: r.fromCapsule })) };
  }

  async replace(userId: string, lines: CartLineInput[]) {
    const ids = [...new Set(lines.map((l) => l.variantId))];
    const known = new Set((await this.prisma.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((v) => v.id));
    const merged = new Map<string, CartLineInput>();
    for (const l of lines) if (known.has(l.variantId)) merged.set(l.variantId, { ...l, qty: Math.min(l.qty, 99) });
    await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({ where: { userId } }),
      this.prisma.cartItem.createMany({ data: [...merged.values()].map((l) => ({ userId, variantId: l.variantId, qty: l.qty, fromCapsule: Boolean(l.fromCapsule) })) }),
    ]);
    return this.get(userId);
  }

  /** Актуальные цены и остатки; недоступные позиции помечаются, а не выбрасываются. */
  async check(lines: CartLineInput[]): Promise<CheckedLine[]> {
    const ids = [...new Set(lines.map((l) => l.variantId))].slice(0, 100);
    if (!ids.length) return [];
    const visible = new Set(
      (await this.prisma.productVariant.findMany({ where: { id: { in: ids }, product: visibleWhere() }, select: { id: true } })).map((v) => v.id),
    );
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: ids } },
      include: {
        color: true,
        salePromotion: true,
        product: { include: { brand: true, supplier: true, media: { where: { approved: true, type: 'photo' }, orderBy: [{ isMain: 'desc' }, { position: 'asc' }], take: 1 } } },
      },
    });
    const out: CheckedLine[] = [];
    for (const l of lines) {
      const v = rows.find((r) => r.id === l.variantId);
      if (!v || out.some((o) => o.variantId === v.id)) continue;
      const thumb = v.product.media[0] ? v.product.media[0].storageKey.replace(/\.webp$/, '_thumb.webp') : null;
      out.push({
        variantId: v.id,
        qty: l.qty,
        fromCapsule: Boolean(l.fromCapsule),
        available: visible.has(v.id) && v.stock > 0,
        stock: v.stock,
        ...shown(v),
        promotionId: v.salePromotionId,
        commissionBp: v.salePromotion ? v.salePromotion.commissionBp : v.product.supplier.commissionBp,
        sku: v.sku,
        size: v.size,
        heightRange: v.heightRange,
        color: v.color.name,
        weightG: v.weightG,
        lengthMm: v.lengthMm,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
        product: { id: v.product.id, slug: v.product.slug, title: v.product.title, brand: v.product.brand.name, image: this.storage.publicUrl(thumb), imageKey: thumb },
        supplier: { id: v.product.supplier.id, name: v.product.supplier.legalName, city: v.product.supplier.warehouseAddress?.split(',')[0] ?? null },
      });
    }
    return out;
  }
}
