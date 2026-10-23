import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminDictionariesController } from '../catalog/admin-dictionaries.controller';
import { DictionariesController } from '../catalog/dictionaries.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { MediaService } from './media.service';
import { ModerationService } from './moderation.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [AuthModule, SuppliersModule],
  controllers: [ProductsController, DictionariesController, AdminDictionariesController],
  providers: [ProductsService, MediaService, ModerationService],
  exports: [ProductsService, MediaService, ModerationService],
})
export class ProductsModule {}
