import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { toKopecks, toRubles } from '@aesculap/shared';
import type { Prisma, ShipmentStatus } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { SettingsService } from '../common/settings.service';
import { RestockService } from '../favorites/restock.service';
import { SupplierOrdersService } from '../orders/supplier-orders.service';
import { repriceSales } from '../promotions/price';
import { catalogChanged } from '../storefront/catalog-cache';
import type { PartnerContext } from './partner.guard';

export type StockItem = { sku: string; stock: number };
export type PriceItem = { sku: string; price: number; oldPrice?: number | null };

const STATUSES: ShipmentStatus[] = ['new', 'confirmed', 'packed', 'handed_over', 'in_transit', 'ready_for_pickup', 'delivered', 'cancelled', 'rejected'];
export const PARTNER_ORDER_FILTERS = [...STATUSES, 'action', 'all'] as const;

/**
 * Партнёрский API поставщика: остатки и цены по SKU пачкой, отправления и их подтверждение.
 * Остатки и цены применяются сразу (как в ручном импорте и YML — без модерации, ТЗ §7.3);
 * пополнение с нуля запускает письма «Сообщить о поступлении», изменения — сброс кэша каталога.
 */
@Injectable()
export class PartnerApiService {
  private readonly logger = new Logger('PartnerApi');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly restock: RestockService,
    private readonly orders: SupplierOrdersService,
    private readonly settings: SettingsService,
  ) {}

  /** Варианты поставщика по SKU (SKU уникален внутри товара, у разных товаров может совпасть — обновляются все) */
  private async variants(supplierId: string, skus: string[]) {
    const rows = await this.prisma.productVariant.findMany({ where: { sku: { in: skus }, product: { supplierId } }, select: { id: true, sku: true, stock: true, price: true, oldPrice: true } });
    const bySku = new Map<string, typeof rows>();
    for (const r of rows) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r]);
    return bySku;
  }

  async stock(p: PartnerContext, items: StockItem[]) {
    const bySku = await this.variants(p.supplier.id, items.map((i) => i.sku));
    const notFound: string[] = [];
    const ids: string[] = [];
    const stocks: number[] = [];
    const restocked: string[] = [];
    let crossedZero = false;
    let unchanged = 0;
    for (const it of items) {
      const vs = bySku.get(it.sku);
      if (!vs) {
        notFound.push(it.sku);
        continue;
      }
      for (const v of vs) {
        if (v.stock === it.stock) {
          unchanged++;
          continue;
        }
        ids.push(v.id);
        stocks.push(it.stock);
        if (v.stock <= 0 && it.stock > 0) restocked.push(v.id);
        if ((v.stock > 0) !== (it.stock > 0)) crossedZero = true;
      }
    }
    if (ids.length) {
      await this.prisma.$executeRaw`
        UPDATE product_variants v SET stock = d.stock
        FROM (SELECT unnest(${ids}::uuid[]) AS id, unnest(${stocks}::int[]) AS stock) d
        WHERE v.id = d.id`;
    }
    // Остаток вырос с нуля — письма подписчикам «Сообщить о поступлении»; витрина — новые «в наличии»
    if (restocked.length) await this.restock.check({ variantIds: restocked }).catch((e: Error) => this.logger.warn(`restock: ${e.message}`));
    if (crossedZero) await catalogChanged(this.redis);
    await this.audit.log(null, 'partner.stock', 'partner_api_key', p.key.id, { supplierId: p.supplier.id, received: items.length, updated: ids.length, notFound: notFound.length });
    return { received: items.length, updated: ids.length, unchanged, notFound };
  }

  async prices(p: PartnerContext, items: PriceItem[]) {
    const bySku = await this.variants(p.supplier.id, items.map((i) => i.sku));
    const notFound: string[] = [];
    const errors: { sku: string; message: string }[] = [];
    const updates: { id: string; price: number; oldPrice: number | null }[] = [];
    let unchanged = 0;
    for (const it of items) {
      const vs = bySku.get(it.sku);
      if (!vs) {
        notFound.push(it.sku);
        continue;
      }
      const price = toKopecks(it.price);
      for (const v of vs) {
        // oldPrice не передан — прежняя «старая цена» остаётся, если она всё ещё выше новой
        const oldPrice = it.oldPrice === undefined ? (v.oldPrice && v.oldPrice > price ? v.oldPrice : null) : it.oldPrice === null ? null : toKopecks(it.oldPrice);
        if (oldPrice !== null && oldPrice <= price) {
          errors.push({ sku: it.sku, message: 'старая цена должна быть выше текущей' });
          break;
        }
        if (v.price === price && v.oldPrice === oldPrice) {
          unchanged++;
          continue;
        }
        updates.push({ id: v.id, price, oldPrice });
      }
    }
    if (updates.length) {
      await this.prisma.$executeRaw`
        UPDATE product_variants v SET price = d.price, "oldPrice" = d.old
        FROM (SELECT unnest(${updates.map((u) => u.id)}::uuid[]) AS id, unnest(${updates.map((u) => u.price)}::int[]) AS price, unnest(${updates.map((u) => u.oldPrice)}::int[]) AS old) d
        WHERE v.id = d.id`;
      // Цена поставщика изменилась — акционная пересчитывается от неё (ТЗ §7.7)
      await repriceSales(this.prisma);
      await catalogChanged(this.redis);
    }
    await this.audit.log(null, 'partner.prices', 'partner_api_key', p.key.id, { supplierId: p.supplier.id, received: items.length, updated: updates.length, notFound: notFound.length, errors: errors.length });
    return { received: items.length, updated: updates.length, unchanged, notFound, errors };
  }

  async listOrders(p: PartnerContext, status: (typeof PARTNER_ORDER_FILTERS)[number], limit: number) {
    const where: Prisma.ShipmentWhereInput = { supplierId: p.supplier.id, status: { not: 'awaiting_payment' } };
    if (status === 'action') where.status = { in: ['new', 'confirmed', 'packed'] };
    else if (status !== 'all') where.status = status;
    const [rows, { confirmHours }] = await Promise.all([
      this.prisma.shipment.findMany({ where, include: { items: true, order: { select: { number: true, recipientName: true } } }, orderBy: { createdAt: 'desc' }, take: limit }),
      this.settings.get(),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        number: `${s.order.number}-${s.no}`,
        status: s.status,
        createdAt: s.createdAt,
        paidAt: s.paidAt,
        // До этого срока отправление нужно подтвердить, иначе оно отменится с возвратом денег
        confirmBefore: s.status === 'new' && s.paidAt ? new Date(s.paidAt.getTime() + confirmHours * 3600_000) : null,
        goodsTotal: toRubles(s.goodsTotal),
        recipientName: s.order.recipientName,
        delivery: { type: s.deliveryType, tariffCode: s.tariffCode, cityCode: s.cityCode, pvzCode: s.pvzCode, address: s.address, trackNo: s.trackNo },
        items: s.items.map((i) => ({ sku: i.sku, title: i.title, size: i.size, heightRange: i.heightRange, color: i.color, qty: i.qty, price: toRubles(i.price) })),
      })),
    };
  }

  async confirm(p: PartnerContext, id: string) {
    const own = await this.prisma.shipment.findFirst({ where: { id, supplierId: p.supplier.id, status: { not: 'awaiting_payment' } }, select: { id: true } });
    if (!own) throw new NotFoundException({ message: 'Отправление не найдено' });
    const d = await this.orders.confirm(p.supplier, id, null, { via: 'partner_api', keyId: p.key.id });
    return { id: d.id, number: d.number, status: d.status };
  }
}
