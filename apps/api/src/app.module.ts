import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { OriginMiddleware } from './common/origin.middleware';
import { HealthController } from './health/health.controller';
import { ImportModule } from './import/import.module';
import { LegalModule } from './legal/legal.module';
import { MeModule } from './me/me.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ProductsModule } from './products/products.module';
import { PremiumModule } from './premium/premium.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ReviewsModule } from './reviews/reviews.module';
import { StorefrontModule } from './storefront/storefront.module';
import { SuppliersModule } from './suppliers/suppliers.module';

@Module({
  imports: [CommonModule, NotificationsModule, AuthModule, SuppliersModule, ProductsModule, ImportModule, AdminModule, StorefrontModule, MeModule, OrdersModule, PromotionsModule, NewsletterModule, LegalModule, PremiumModule, FavoritesModule, ReviewsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginMiddleware).forRoutes('*');
  }
}
