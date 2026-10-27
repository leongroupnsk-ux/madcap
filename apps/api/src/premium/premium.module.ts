import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeModule } from '../me/me.module';
import { OrdersModule } from '../orders/orders.module';
import { PremiumOrderService } from './premium-order.service';
import { AdminPremiumController, PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';

@Module({ imports: [AuthModule, MeModule, OrdersModule], controllers: [PremiumController, AdminPremiumController], providers: [PremiumService, PremiumOrderService] })
export class PremiumModule {}
