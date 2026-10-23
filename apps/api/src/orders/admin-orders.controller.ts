import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { reasonSchema } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { ZodPipe } from '../common/zod.pipe';
import { AdminOrdersService } from './admin-orders.service';

const refundSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
    .max(100)
    .refine((x) => new Set(x.map((i) => i.itemId)).size === x.length, 'Каждый товар — одной строкой'),
  withDelivery: z.boolean().default(false),
  reason: z.string().trim().min(3, 'Укажите причину').max(500),
});
const dateSchema = z.coerce.date();

@Controller('admin/orders')
@Roles('admin')
@Area('orders')
export class AdminOrdersController {
  constructor(private readonly svc: AdminOrdersService) {}

  @Get()
  search(@Query('q') q?: string, @Query('status') status?: string) {
    return this.svc.search({ q, status });
  }

  /** Сверка с платёжкой за период (по умолчанию — двое суток) */
  @Get('reconcile')
  reconcile(@Query('from') from?: string, @Query('to') to?: string) {
    const end = to ? dateSchema.parse(to) : new Date();
    const start = from ? dateSchema.parse(from) : new Date(end.getTime() - 2 * 86400000);
    return this.svc.reconcile(start, end);
  }

  @Get(':number')
  view(@Param('number') number: string) {
    return this.svc.view(number);
  }

  @Post(':number/shipments/:no/cancel')
  @HttpCode(200)
  cancel(@Param('number') number: string, @Param('no', ParseIntPipe) no: number, @Body(new ZodPipe(reasonSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    return this.svc.cancel(number, no, body.reason, admin);
  }

  @Post(':number/shipments/:no/refund')
  @HttpCode(200)
  refund(@Param('number') number: string, @Param('no', ParseIntPipe) no: number, @Body(new ZodPipe(refundSchema)) body: z.infer<typeof refundSchema>, @CurrentUser() admin: User) {
    return this.svc.refund(number, no, body, admin);
  }

  @Post(':number/sync-payment')
  @HttpCode(200)
  sync(@Param('number') number: string, @CurrentUser() admin: User) {
    return this.svc.syncPayment(number, admin);
  }
}
