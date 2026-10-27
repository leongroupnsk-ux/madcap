import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { PARTNER_ORDER_FILTERS, PartnerApiService, type PriceItem, type StockItem } from './partner-api.service';
import { PartnerKeysService } from './partner-keys.service';
import { CurrentPartner, PartnerKeyGuard, type PartnerContext } from './partner.guard';

const MAX_BATCH = 1000;
const sku = z.string().trim().min(1, 'пустой SKU').max(100);
const rub = z.number().positive('цена должна быть больше 0').max(10_000_000).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'не больше двух знаков после запятой');

/** Одинаковые SKU в одной пачке — ошибка: неясно, какое значение применить */
const uniqueSkus = <T extends { sku: string }>(items: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  items.forEach((it, i) => {
    if (seen.has(it.sku)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'sku'], message: `SKU ${it.sku} повторяется в запросе` });
    seen.add(it.sku);
  });
};

const stockSchema = z
  .object({ items: z.array(z.object({ sku, stock: z.number().int('остаток — целое число').min(0, 'остаток не меньше 0').max(1_000_000) })).min(1, 'пустой список').max(MAX_BATCH, `не больше ${MAX_BATCH} позиций за запрос`) })
  .superRefine((b, ctx) => uniqueSkus(b.items, ctx));
const pricesSchema = z
  .object({ items: z.array(z.object({ sku, price: rub, oldPrice: rub.nullable().optional() })).min(1, 'пустой список').max(MAX_BATCH, `не больше ${MAX_BATCH} позиций за запрос`) })
  .superRefine((b, ctx) => uniqueSkus(b.items, ctx));
const keySchema = z.object({ name: z.string().trim().min(1, 'Назовите ключ, например «1С склад»').max(60, 'Не длиннее 60 символов') });

/**
 * Партнёрский API v1 (docs/PARTNER_API.md). Аутентификация — ключ поставщика в заголовке Authorization,
 * cookie и проверка Origin не используются (запросы идут с сервера поставщика).
 */
@Controller('partner/v1')
@UseGuards(PartnerKeyGuard)
export class PartnerApiController {
  constructor(private readonly api: PartnerApiService) {}

  @Put('stock')
  stock(@CurrentPartner() p: PartnerContext, @Body(new ZodPipe(stockSchema)) body: { items: StockItem[] }) {
    return this.api.stock(p, body.items);
  }

  @Put('prices')
  prices(@CurrentPartner() p: PartnerContext, @Body(new ZodPipe(pricesSchema)) body: { items: PriceItem[] }) {
    return this.api.prices(p, body.items);
  }

  @Get('orders')
  orders(@CurrentPartner() p: PartnerContext, @Query('status') status = 'action', @Query('limit') limit = '100') {
    if (!(PARTNER_ORDER_FILTERS as readonly string[]).includes(status)) throw new BadRequestException({ message: `status — одно из: ${PARTNER_ORDER_FILTERS.join(', ')}` });
    const n = Math.min(100, Math.max(1, Number(limit) || 100));
    return this.api.listOrders(p, status as (typeof PARTNER_ORDER_FILTERS)[number], n);
  }

  @Post('orders/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentPartner() p: PartnerContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.confirm(p, id);
  }
}

/** Ключи API в настройках кабинета: создаёт и отзывает только владелец поставщика */
@Controller('supplier/api-keys')
@SupplierAccess('owner')
export class SupplierApiKeysController {
  constructor(private readonly keys: PartnerKeysService) {}

  @Get()
  list(@CurrentSupplier() ctx: SupplierContext) {
    return this.keys.list(ctx.supplier.id);
  }

  @Post()
  create(@CurrentSupplier() ctx: SupplierContext, @Body(new ZodPipe(keySchema)) body: { name: string }, @CurrentUser() user: User) {
    return this.keys.create(ctx.supplier, body.name, user);
  }

  @Delete(':id')
  revoke(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.keys.revoke(ctx.supplier, id, user);
  }
}
