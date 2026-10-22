import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { payoutDetailsSchema, reasonSchema, type PayoutDetailsInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { SupplierOrdersService } from './supplier-orders.service';

const optionalReason = z.object({ reason: z.string().trim().max(500).optional() });
const activateSchema = z.object({ accountId: z.string().trim().min(3, 'Укажите ID получателя ЮKassa').max(64) });

@Controller('supplier')
export class SupplierOrdersController {
  constructor(private readonly svc: SupplierOrdersService) {}

  @Get('orders')
  @SupplierAccess('owner', 'warehouse')
  list(@CurrentSupplier() ctx: SupplierContext, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.list(ctx.supplier, { status, q });
  }

  @Get('orders/counters')
  @SupplierAccess()
  counters(@CurrentSupplier() ctx: SupplierContext) {
    return this.svc.counters(ctx.supplier);
  }

  @Get('orders/:id')
  @SupplierAccess('owner', 'warehouse')
  detail(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(ctx.supplier, id);
  }

  @Post('orders/:id/confirm')
  @SupplierAccess('owner', 'warehouse')
  @HttpCode(200)
  confirm(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.svc.confirm(ctx.supplier, id, user);
  }

  @Post('orders/:id/pack')
  @SupplierAccess('owner', 'warehouse')
  @HttpCode(200)
  pack(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.svc.pack(ctx.supplier, id, user);
  }

  @Post('orders/:id/reject')
  @SupplierAccess('owner', 'warehouse')
  @HttpCode(200)
  reject(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }, @CurrentUser() user: User) {
    return this.svc.reject(ctx.supplier, id, body.reason, user);
  }

  @Post('orders/:id/waybill')
  @SupplierAccess('owner', 'warehouse')
  @HttpCode(200)
  waybill(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.svc.waybill(ctx.supplier, id, user);
  }

  @Get('orders/:id/documents/:kind')
  @SupplierAccess('owner', 'warehouse')
  async document(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Res({ passthrough: true }) res: Response) {
    if (kind !== 'waybill' && kind !== 'barcode') throw new BadRequestException();
    const doc = await this.svc.document(ctx.supplier, id, kind);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc.name}"` });
    return new StreamableFile(doc.pdf);
  }

  @Post('returns/:id/approve')
  @SupplierAccess('owner', 'warehouse')
  @HttpCode(200)
  approveReturn(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.svc.decideReturn(ctx.supplier, id, true, undefined, user);
  }

  @Post('returns/:id/reject')
  @SupplierAccess('owner', 'warehouse')
  @HttpCode(200)
  rejectReturn(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(optionalReason)) body: { reason?: string }, @CurrentUser() user: User) {
    return this.svc.decideReturn(ctx.supplier, id, false, body.reason, user);
  }

  @Get('payouts')
  @SupplierAccess('owner')
  payouts(@CurrentSupplier() ctx: SupplierContext, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.payouts(ctx.supplier, { from, to });
  }

  @Get('payouts/report')
  @SupplierAccess('owner')
  async report(@CurrentSupplier() ctx: SupplierContext, @Query('month') month: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.report(ctx.supplier, month ?? '');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.name}"` });
    return r.csv;
  }

  @Put('payouts/details')
  @SupplierAccess('owner')
  details(@CurrentSupplier() ctx: SupplierContext, @Body(new ZodPipe(payoutDetailsSchema)) body: PayoutDetailsInput, @CurrentUser() user: User) {
    return this.svc.setDetails(ctx.supplier, body, user);
  }
}

/** Админка: подключение выплат после онбординга в ЮKassa (ТЗ §8). */
@Controller('admin/payouts')
@Roles('admin')
export class AdminPayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.supplier.findMany({ where: { status: 'active' }, orderBy: [{ payoutStatus: 'asc' }, { legalName: 'asc' }] });
    return rows.map((s) => ({
      id: s.id, legalName: s.legalName, inn: s.inn, payoutStatus: s.payoutStatus, accountId: s.yookassaAccountId,
      details: s.payoutLegalName ? { legalName: s.payoutLegalName, inn: s.payoutInn, bik: s.payoutBik, account: s.payoutAccount ? `•••• ${s.payoutAccount.slice(-4)}` : null } : null,
      requestedAt: s.payoutRequestedAt,
    }));
  }

  @Post(':supplierId/activate')
  @HttpCode(200)
  async activate(@Param('supplierId', ParseUUIDPipe) id: string, @Body(new ZodPipe(activateSchema)) body: { accountId: string }, @CurrentUser() admin: User) {
    const s = await this.prisma.supplier.update({ where: { id }, data: { yookassaAccountId: body.accountId, payoutStatus: 'active' } });
    await this.audit.log(admin.id, 'supplier.payouts.activate', 'supplier', id, { accountId: body.accountId });
    return { id: s.id, payoutStatus: s.payoutStatus };
  }
}
