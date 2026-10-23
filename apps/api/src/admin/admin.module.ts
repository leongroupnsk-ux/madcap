import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AdminController } from './admin.controller';
import { SystemController } from './system.controller';

@Module({ imports: [AuthModule, SuppliersModule, ProductsModule], controllers: [AdminController, SystemController] })
export class AdminModule {}
