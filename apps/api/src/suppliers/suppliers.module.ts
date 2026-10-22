import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupplierGuard } from './supplier.guard';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AuthModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierGuard],
  exports: [SuppliersService, SupplierGuard],
})
export class SuppliersModule {}
