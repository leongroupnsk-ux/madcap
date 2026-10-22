import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({ imports: [AuthModule, SuppliersModule, ProductsModule], controllers: [ImportController], providers: [ImportService] })
export class ImportModule {}
