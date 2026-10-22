import { Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { shortId, slugify } from '../common/slug';
import { ZodPipe } from '../common/zod.pipe';
import { SupplierAccess } from '../suppliers/supplier.guard';

const brandSchema = z.object({ name: z.string().trim().min(2, 'Название бренда').max(60) });

@Controller()
export class DictionariesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('dictionaries')
  async all() {
    const [categories, colors, groups, brands] = await Promise.all([
      this.prisma.category.findMany({ orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { position: 'asc' }] }),
      this.prisma.color.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.specialtyGroup.findMany({ orderBy: { position: 'asc' }, include: { specialties: { orderBy: { position: 'asc' } } } }),
      this.prisma.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
    ]);
    return {
      categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, slot: c.slot })),
      // Сортировка по-русски в коде: у БД может быть C-collation.
      colors: colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      specialtyGroups: groups.map((g) => ({ id: g.id, name: g.name, specialties: g.specialties.map((s) => ({ id: s.id, name: s.name })) })),
      brands: brands.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    };
  }

  /** Поставщик может добавить свой бренд; дубли по названию не создаются. */
  @Post('supplier/brands')
  @SupplierAccess('owner', 'catalog')
  async createBrand(@Body(new ZodPipe(brandSchema)) body: { name: string }, @CurrentUser() user: User) {
    const existing = await this.prisma.brand.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } });
    if (existing) throw new ConflictException({ message: 'Такой бренд уже есть — выберите его в списке', brand: existing });
    const brand = await this.prisma.brand.create({ data: { name: body.name, slug: `${slugify(body.name) || 'brand'}-${shortId()}` } });
    await this.audit.log(user.id, 'brand.create', 'brand', brand.id, { name: body.name });
    return { id: brand.id, name: brand.name, slug: brand.slug };
  }
}
