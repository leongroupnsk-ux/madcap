import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, StreamableFile, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { ImportService } from './import.service';
import { buildTemplate } from './parse';

const feedSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Введите ссылку на фид, например https://shop.ru/export/yml.xml')
    .refine((u) => /^https?:\/\//.test(u), 'Ссылка должна начинаться с http(s)://')
    .nullable(),
});

@Controller('supplier/import')
@SupplierAccess('owner', 'catalog')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Get()
  list(@CurrentSupplier() ctx: SupplierContext) {
    return this.imports.list(ctx.supplier.id);
  }

  @Get('template.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="aesculap-template.xlsx"')
  async template() {
    return new StreamableFile(await buildTemplate());
  }

  @Post('file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1048576, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    if (!file) throw new BadRequestException({ message: 'Выберите файл' });
    // multer отдаёт имя в latin1 — восстанавливаем кириллицу
    const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.imports.uploadFile(ctx.supplier, { originalname, buffer: file.buffer }, user);
  }

  @Put('feed')
  feed(@Body(new ZodPipe(feedSchema)) body: { url: string | null }, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.imports.setFeed(ctx.supplier, body.url, user);
  }

  @Post('feed/sync')
  @HttpCode(200)
  sync(@CurrentSupplier() ctx: SupplierContext) {
    return this.imports.syncFeed(ctx.supplier.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.imports.get(ctx.supplier.id, id);
  }

  @Get(':id/errors.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="import-errors.csv"')
  errors(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.imports.errorsCsv(ctx.supplier.id, id);
  }

  @Post(':id/apply')
  @HttpCode(200)
  apply(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.imports.requestApply(ctx.supplier, id, user);
  }
}
