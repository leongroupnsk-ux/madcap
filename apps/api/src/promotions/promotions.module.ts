import { Body, Controller, Delete, Get, HttpCode, Module, OnApplicationBootstrap, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { promotionApplySchema, promotionSchema, type PromotionInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { JobsService } from '../common/jobs.service';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { PromotionsService } from './promotions.service';

const decideSchema = z.object({ reason: z.string().trim().max(500).optional() });

@Controller('admin/promotions')
@Roles('admin')
class AdminPromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get()
  list() {
    return this.svc.adminList();
  }

  @Post()
  create(@Body(new ZodPipe(promotionSchema)) body: PromotionInput, @CurrentUser() admin: User) {
    return this.svc.create(body, admin);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(promotionSchema)) body: PromotionInput, @CurrentUser() admin: User) {
    return this.svc.update(id, body, admin);
  }

  @Get('applications')
  applications(@Query('status') status?: string) {
    return this.svc.applications(status === 'approved' || status === 'rejected' ? status : 'pending');
  }

  @Post('applications/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    return this.svc.decide(id, true, undefined, admin);
  }

  @Post('applications/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decideSchema)) body: { reason?: string }, @CurrentUser() admin: User) {
    return this.svc.decide(id, false, body.reason, admin);
  }
}

@Controller('supplier/promotions')
@SupplierAccess('owner', 'catalog')
class SupplierPromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get()
  list(@CurrentSupplier() ctx: SupplierContext) {
    return this.svc.supplierList(ctx.supplier);
  }

  @Get('product/:productId')
  forProduct(@CurrentSupplier() ctx: SupplierContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.svc.forProduct(ctx.supplier, productId);
  }

  @Get(':id')
  products(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.supplierProducts(ctx.supplier, id);
  }

  @Post(':id/products')
  @HttpCode(200)
  apply(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(promotionApplySchema)) body: { items: { productId: string; discountPct: number }[] }, @CurrentUser() user: User) {
    return this.svc.apply(ctx.supplier, id, body.items, user);
  }

  @Delete(':id/products/:productId')
  withdraw(@CurrentSupplier() ctx: SupplierContext, @Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string, @CurrentUser() user: User) {
    return this.svc.withdraw(ctx.supplier, id, productId, user);
  }
}

@Controller('promotions')
class PublicPromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get('active')
  active() {
    return this.svc.active();
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AdminPromotionsController, SupplierPromotionsController, PublicPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly svc: PromotionsService,
  ) {}

  /** Старт и окончание акций подхватываются пересчётом раз в минуту. */
  async onApplicationBootstrap() {
    this.jobs.register('promotions.reprice', async () => void (await this.svc.reprice()));
    await this.jobs.repeat('promotions.reprice', 60_000);
  }
}
