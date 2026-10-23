import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { articleSaveSchema, collectionSaveSchema, rejectSchema, type ArticleSaveInput, type CollectionSaveInput } from '@aesculap/shared';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { CapsuleService } from '../me/capsule.service';
import { CatalogService, type CatalogQuery, type FitContext } from './catalog.service';
import { ContentService } from './content.service';

/** Публичная витрина: без авторизации (ТЗ §4). */
@Controller()
export class StorefrontController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly content: ContentService,
    private readonly sessions: SessionService,
    private readonly capsules: CapsuleService,
  ) {}

  /** Если покупатель вошёл и прошёл анкету — витрина отмечает подходящие товары. */
  private async fit(req: Request): Promise<FitContext | null> {
    const s = await this.sessions.resolve(req).catch(() => null);
    if (!s) return null;
    const ctx = await this.capsules.fitContext(s.user.id);
    if (!ctx) return null;
    return { gender: ctx.profile.gender, heightRange: ctx.heightRange, specialtyIds: ctx.profile.specialties.map((x) => x.specialtyId), sizeFor: ctx.sizeFor };
  }

  @Get('catalog/home')
  async home(@Req() req: Request) {
    return this.catalog.home(await this.fit(req));
  }

  @Get('catalog/categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('catalog/products')
  async list(@Query() q: CatalogQuery, @Req() req: Request) {
    return this.catalog.list(q, await this.fit(req));
  }

  @Get('catalog/products/:slug')
  async product(@Param('slug') slug: string, @Req() req: Request) {
    return this.catalog.product(slug, await this.fit(req));
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
    return this.content.saveArticle(ctx.supplier.id, null, body, user);
  }

  @Put('articles/:id')
  saveArticle(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveArticle(ctx.supplier.id, id, body, user);
  }

  @Get('collections/:id')
  getCollection(@Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.content.getCollection(ctx.supplier.id, id);
  }

  @Post('collections')
  createCollection(@Body(new ZodPipe(collectionSaveSchema)) body: CollectionSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveCollection(ctx.supplier.id, null, body, user);
  }

  @Put('collections/:id')
  saveCollection(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(collectionSaveSchema)) body: CollectionSaveInput, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.saveCollection(ctx.supplier.id, id, body, user);
  }

  @Post(':kind/:id/submit')
  @HttpCode(204)
  submit(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext, @CurrentUser() user: User) {
    return this.content.submit(ctx.supplier, kindOf(kind), id, user);
  }

  @Delete(':kind/:id')
  @HttpCode(204)
  remove(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.content.remove(ctx.supplier.id, kindOf(kind), id);
  }
}

/** Журнал редакции площадки (ТЗ §8: «статьи редакции»): те же материалы, автор — площадка, публикация без модерации */
@Controller('admin/editorial')
@Roles('admin')
@Area('editorial')
export class AdminEditorialController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list() {
    return this.content.supplierList(null);
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1048576, files: 1 } }))
  image(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException({ message: 'Выберите файл' });
    return this.content.uploadImage(file);
  }

  @Get('articles/:id')
  getArticle(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getArticle(null, id);
  }

  @Post('articles')
  createArticle(@Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput, @CurrentUser() user: User) {
    return this.content.saveArticle(null, null, body, user);
  }

  @Put('articles/:id')
  saveArticle(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(articleSaveSchema)) body: ArticleSaveInput, @CurrentUser() user: User) {
    return this.content.saveArticle(null, id, body, user);
  }

  @Get('collections/:id')
  getCollection(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getCollection(null, id);
  }

  @Post('collections')
  createCollection(@Body(new ZodPipe(collectionSaveSchema)) body: CollectionSaveInput, @CurrentUser() user: User) {
    return this.content.saveCollection(null, null, body, user);
  }

  @Put('collections/:id')
  saveCollection(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(collectionSaveSchema)) body: CollectionSaveInput, @CurrentUser() user: User) {
    return this.content.saveCollection(null, id, body, user);
  }

  @Post(':kind/:id/publish')
  @HttpCode(200)
  publish(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.content.publishEditorial(kindOf(kind), id, true, user);
  }

  @Post(':kind/:id/unpublish')
  @HttpCode(200)
  unpublish(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.content.publishEditorial(kindOf(kind), id, false, user);
  }

  @Delete(':kind/:id')
  @HttpCode(204)
  remove(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.content.remove(null, kindOf(kind), id);
  }
}

@Controller('admin/content')
@Roles('admin')
@Area('moderation')
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
