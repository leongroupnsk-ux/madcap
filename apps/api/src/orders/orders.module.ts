import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsService } from '../common/jobs.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { CartService } from './cart.service';
import { OrdersController } from './orders.controller';
import { PayoutRegistryService } from './payout-registry.service';
import { OrdersService } from './orders.service';
import { AdminPayoutsController, SupplierOrdersController } from './supplier-orders.controller';
import { SupplierOrdersService } from './supplier-orders.service';
import { SupplierPrintService } from './supplier-print.service';

@Module({
  imports: [AuthModule, DeliveryModule, PaymentsModule],
  controllers: [OrdersController, SupplierOrdersController, AdminPayoutsController, AdminOrdersController],
  providers: [CartService, OrdersService, SupplierOrdersService, AdminOrdersService, PayoutRegistryService, SupplierPrintService],
  exports: [OrdersService, SupplierOrdersService, CartService],
})
export class OrdersModule implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly orders: OrdersService,
    private readonly supplierOrders: SupplierOrdersService,
  ) {}

  /** Таймеры: просрочка оплаты и автоотмена — раз в минуту, опрос статусов СДЭК — раз в час (ТЗ §10). */
  async onApplicationBootstrap() {
    this.jobs.register('orders.sweep', async () => void (await this.orders.sweep()));
    this.jobs.register('delivery.poll', async () => void (await this.supplierOrders.pollAll()));
    await this.jobs.repeat('orders.sweep', 60_000);
    await this.jobs.repeat('delivery.poll', 3_600_000);
  }
}
