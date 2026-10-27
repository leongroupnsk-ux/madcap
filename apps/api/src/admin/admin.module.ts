import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AdminController } from './admin.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { MailTemplatesController } from './mail-templates.controller';
import { SystemController } from './system.controller';

@Module({
  imports: [AuthModule, SuppliersModule, ProductsModule],
  controllers: [AdminController, SystemController, DashboardController, MailTemplatesController],
  providers: [DashboardService],
})
export class AdminModule {}
