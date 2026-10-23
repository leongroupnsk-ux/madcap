import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import { MAX_VIDEO_MB, productSaveSchema, type ProductSaveInput } from '@aesculap/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { ProductsService, type ListQuery } from './products.service';

const idsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

const mediaColorSchema = z.object({ colorId: z.string().uuid().nullable() });

@Controller('supplier/products')
@SupplierAccess('owner', 'catalog')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentSupplier() ctx: SupplierContext, @Query() query: ListQuery) {
    return this.products.list(ctx.supplier.id, query);
  }

  @Get('summary')
  summary(@CurrentSupplier() ctx: SupplierContext) {
    return this.products.summary(ctx.supplier.id);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products.csv"')
  exportCsv(@CurrentSupplier() ctx: SupplierContext) {
    return this.products.exportCsv(ctx.supplier.id);
  }

  @Post()
  create(@Body(new ZodPipe(productSaveSchema)) body: ProductSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.create(ctx.supplier, body, user);
  }

  @Post('bulk-hide')
  @HttpCode(200)
  bulkHide(@Body(new ZodPipe(idsSchema)) body: { ids: string[] }, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.bulkHide(ctx.supplier, body.ids, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.products.get(ctx.supplier.id, id);
  }

  @Put(':id')
  save(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productSaveSchema)) body: ProductSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.save(ctx.supplier, id, body, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.submit(ctx.supplier, id, user);
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.setHidden(ctx.supplier, id, true, user);
  }

  @Post(':id/unhide')
  @HttpCode(200)
  unhide(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.setHidden(ctx.supplier, id, false, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.products.remove(ctx.supplier, id, user);
  }

  @Put(':id/media/:mediaId/color')
  mediaColor(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body(new ZodPipe(mediaColorSchema)) body: { colorId: string | null },
    @CurrentSupplier() ctx: SupplierContext,
    @CurrentUser() user: User,
  ) {
    return this.products.setMediaColor(ctx.supplier, id, mediaId, body.colorId, user);
  }

  @Post(':id/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VIDEO_MB * 1048576 + 1024, files: 1 } }))
  upload(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentSupplier() ctx: SupplierContext) {
    if (!file) return this.products.get(ctx.supplier.id, id);
    return this.products.addMedia(ctx.supplier, id, file);
  }
}
