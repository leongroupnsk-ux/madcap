import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PartnerApiService } from './partner-api.service';
import { PartnerApiController, SupplierApiKeysController } from './partner.controller';
import { PartnerKeyGuard } from './partner.guard';
import { PartnerKeysService } from './partner-keys.service';

/** Партнёрский API поставщиков и ключи доступа к нему */
@Module({
  imports: [AuthModule, SuppliersModule, OrdersModule],
  controllers: [PartnerApiController, SupplierApiKeysController],
  providers: [PartnerKeysService, PartnerApiService, PartnerKeyGuard],
})
export class PartnerModule {}
