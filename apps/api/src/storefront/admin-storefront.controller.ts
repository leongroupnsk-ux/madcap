import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { storefrontSchema, type StorefrontSettings } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { ZodPipe } from '../common/zod.pipe';
import { visibleWhere } from './catalog.service';
import { PHOTOS, photosFor, thumbKey } from './media-pick';

/** Витрина (ТЗ §8): главный блок, премиум-баннер, «Хиты недели», «Капсула недели» — у редактора. */
@Controller('admin/storefront')
@Roles('admin')
@Area('catalog')
export class AdminStorefrontController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async products(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids } }, include: { brand: true, media: PHOTOS } });
    return ids
      .map((id) => rows.find((r) => r.id === id))
      .filter((r) => r !== undefined)
      .map((r) => ({ id: r.id, title: r.title, brand: r.brand.name, image: this.storage.publicUrl(thumbKey(photosFor(r.media, null)[0])), visible: r.moderationStatus === 'published' }));
  }

  @Get()
  async get() {
    const sf = await this.settings.storefront();
    return { settings: sf, hits: await this.products(sf.hitsProductIds), capsule: await this.products(sf.capsuleOfWeek.productIds) };
  }

  @Put()
  async save(@Body(new ZodPipe(storefrontSchema)) body: StorefrontSettings, @CurrentUser() admin: User) {
    await this.settings.setStorefront(body, admin.id);
    await this.audit.log(admin.id, 'storefront.update', 'storefront', undefined, { hits: body.hitsProductIds.length, capsule: body.capsuleOfWeek.productIds.length });
    return this.get();
  }

  /** Поиск опубликованных товаров для подборок */
  @Get('products')
  async search(@Query('q') q = '') {
    const term = String(q).trim();
    const rows = await this.prisma.product.findMany({
      where: { AND: [visibleWhere(), term ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { brand: { name: { contains: term, mode: 'insensitive' } } }] } : {}] },
      include: { brand: true, media: PHOTOS },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, title: r.title, brand: r.brand.name, image: this.storage.publicUrl(thumbKey(photosFor(r.media, null)[0])), visible: true }));
  }
}
