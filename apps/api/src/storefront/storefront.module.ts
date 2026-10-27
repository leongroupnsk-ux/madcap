import { AdminSearchController } from './admin-search.controller';
import { AdminStorefrontController } from './admin-storefront.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { MeModule } from '../me/me.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CatalogService } from './catalog.service';
import { ContentService } from './content.service';
import { AdminContentController, AdminEditorialController, StorefrontController, SupplierContentController } from './storefront.controller';

@Module({
  imports: [AuthModule, SuppliersModule, MeModule, DeliveryModule],
  controllers: [StorefrontController, SupplierContentController, AdminContentController, AdminStorefrontController, AdminEditorialController, AdminSearchController],
  providers: [CatalogService, ContentService],
  exports: [CatalogService],
})
export class StorefrontModule {}
