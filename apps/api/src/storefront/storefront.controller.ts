import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import { articleSaveSchema, collectionSaveSchema, rejectSchema, type ArticleSaveInput, type CollectionSaveInput } from '@aesculap/shared';
import { CurrentUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { CatalogService, type CatalogQuery } from './catalog.service';
import { ContentService } from './content.service';

/** Публичная витрина: без авторизации (ТЗ §4). */
@Controller()
export class StorefrontController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly content: ContentService,
  ) {}

  @Get('catalog/home')
  home() {
    return this.catalog.home();
  }

  @Get('catalog/categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('catalog/products')
  list(@Query() q: CatalogQuery) {
    return this.catalog.list(q);
  }

  @Get('catalog/products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalog.product(slug);
  }

  @Get('catalog/suggest')
  suggest(@Query('q') q = '') {
    return this.catalog.suggest(q.slice(0, 100));
  }

  @Get('catalog/variants')
  variants(@Query('ids') ids = '') {
    return this.catalog.variants(ids.split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)));
  }

  @Get('catalog/sitemap')
  sitemap() {
    return this.catalog.sitemap();
  }

  @Get('journal')
  journal() {
    return this.content.journal();
  }

  @Get('journal/articles/:slug')
  article(@Param('slug') slug: string) {
    return this.content.article(slug);
  }

  @Get('journal/collections/:slug')
  collection(@Param('slug') slug: string) {
    return this.content.collection(slug);
  }
}

/** Контент поставщика (ТЗ §7.6). */
@Controller('supplier/content')
@SupplierAccess('owner', 'catalog')
export class SupplierContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@CurrentSupplier() ctx: SupplierContext) {
    return this.content.supplierList(ctx.supplier.id);
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1048576, files: 1 } }))
  image(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException({ message: 'Выберите файл' });
    return this.content.uploadImage(file);
  }

  @Get('articles/:id')
  getArticle(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.content.getArticle(ctx.supplier.id, id);
  }

  @Post('articles')
  createArticle(@Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveArticle(ctx.supplier, null, body, user);
  }

  @Put('articles/:id')
  saveArticle(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveArticle(ctx.supplier, id, body, user);
  }

  @Get('collections/:id')
  getCollection(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.content.getCollection(ctx.supplier.id, id);
  }

  @Post('collections')
  createCollection(@Body(new ZodPipe(collectionSaveSchema)) body: CollectionSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveCollection(ctx.supplier, null, body, user);
  }

  @Put('collections/:id')
  saveCollection(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(collectionSaveSchema)) body: CollectionSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveCollection(ctx.supplier, id, body, user);
  }

  @Post(':kind/:id/submit')
  @HttpCode(204)
  submit(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.submit(ctx.supplier, kindOf(kind), id, user);
  }

  @Delete(':kind/:id')
  @HttpCode(204)
  remove(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.content.remove(ctx.supplier, kindOf(kind), id);
  }
}

@Controller('admin/content')
@Roles('admin')
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  queue() {
    return this.content.queue();
  }

  @Get(':kind/:id')
  preview(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.content.adminPreview(kindOf(kind), id);
  }

  @Post(':kind/:id/approve')
  @HttpCode(204)
  approve(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    return this.content.decide(kindOf(kind), id, true, null, admin);
  }

  @Post(':kind/:id/reject')
  @HttpCode(204)
  reject(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    return this.content.decide(kindOf(kind), id, false, body.reason, admin);
  }
}

function kindOf(kind: string): 'article' | 'collection' {
  if (kind === 'articles' || kind === 'article') return 'article';
  if (kind === 'collections' || kind === 'collection') return 'collection';
  throw new BadRequestException({ message: 'Неизвестный тип материала' });
}
