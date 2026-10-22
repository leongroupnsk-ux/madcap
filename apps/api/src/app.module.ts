import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { OriginMiddleware } from './common/origin.middleware';
import { HealthController } from './health/health.controller';
import { ImportModule } from './import/import.module';
import { ProductsModule } from './products/products.module';
import { StorefrontModule } from './storefront/storefront.module';
import { SuppliersModule } from './suppliers/suppliers.module';

@Module({
  imports: [CommonModule, AuthModule, SuppliersModule, ProductsModule, ImportModule, AdminModule, StorefrontModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginMiddleware).forRoutes('*');
  }
}
