import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ProductStatsService } from './product-stats.service';
import { SupplierAnalyticsService } from './supplier-analytics.service';

/** Кабинет «Аналитика» — выручка и продажи только владельцу (как выплаты) */
@Controller('supplier/analytics')
@SupplierAccess('owner')
class SupplierAnalyticsController {
  constructor(private readonly svc: SupplierAnalyticsService) {}

  @Get()
  overview(@CurrentSupplier() ctx: SupplierContext, @Query('days') days?: string) {
    return this.svc.overview(ctx.supplier.id, days === '90' ? 90 : 30);
  }
}

/** Глобальный: ProductStatsService вызывают корзина и витрина (просмотр карточки) */
@Global()
@Module({
  imports: [AuthModule, SuppliersModule],
  controllers: [SupplierAnalyticsController],
  providers: [ProductStatsService, SupplierAnalyticsService],
  exports: [ProductStatsService],
})
export class AnalyticsModule {}
