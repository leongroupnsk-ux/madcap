import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  brandMergeSchema, brandSchema, categorySchema, colorSchema, specialtyGroupSchema, specialtySchema,
  type BrandInput, type CategoryInput, type ColorInput, type SpecialtyGroupInput, type SpecialtyInput,
} from '@aesculap/shared';
import { Prisma, type User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { shortId, slugify } from '../common/slug';
import { ZodPipe } from '../common/zod.pipe';

/** Уникальность (slug, название) — понятной ошибкой поля, а не 500 */
function unique<T>(p: Promise<T>, field: 'slug' | 'name') {
  return p.catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException({ message: field === 'slug' ? 'Такой адрес (slug) уже занят' : 'Такое название уже есть', errors: { [field]: 'Уже занято' } });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
    throw e;
  });
}
const inUse = (what: string) => new ConflictException({ message: `Нельзя удалить: ${what}. Сначала перенесите или переименуйте.` });

/** Каталог и справочники (ТЗ §8): категории, специальности и группы, цвета, бренды и таблицы размеров. */
@Controller('admin/dictionaries')
@Roles('admin')
export class AdminDictionariesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private log(admin: User, action: string, entity: string, id: string, data?: object) {
    return this.audit.log(admin.id, `dictionary.${action}`, entity, id, data as Prisma.InputJsonValue);
  }

  @Get()
  async all() {
    const [categories, groups, colors, brands] = await Promise.all([
      this.prisma.category.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: true, children: true } } } }),
      this.prisma.specialtyGroup.findMany({ orderBy: { position: 'asc' }, include: { specialties: { orderBy: { position: 'asc' }, include: { _count: { select: { products: true, profiles: true } } } } } }),
      this.prisma.color.findMany({ include: { _count: { select: { variants: true } } } }),
      this.prisma.brand.findMany({ include: { _count: { select: { products: true } } } }),
    ]);
    const ru = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
    return {
      categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, slot: c.slot, position: c.position, products: c._count.products, children: c._count.children })),
      specialtyGroups: groups.map((g) => ({
        id: g.id, name: g.name, position: g.position,
        specialties: g.specialties.map((s) => ({ id: s.id, name: s.name, slug: s.slug, position: s.position, slots: ((s.rules as { slots?: string[] }).slots ?? []), products: s._count.products, profiles: s._count.profiles })),
      })),
      colors: colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, colorFamily: c.colorFamily, variants: c._count.variants })).sort(ru),
      brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug, sizeChart: b.sizeChart, products: b._count.products })).sort(ru),
    };
  }

  // ─── категории ───────────────────────────────────────────────────────

  private async checkParent(id: string | null, parentId: string | null) {
    if (!parentId) return;
    if (parentId === id) throw new BadRequestException({ message: 'Категория не может быть родителем сама себе', errors: { parentId: 'Выберите другую' } });
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException({ message: 'Родитель не найден', errors: { parentId: 'Не найдено' } });
    // Дерево в два уровня, как в меню витрины
    if (parent.parentId) throw new BadRequestException({ message: 'Подкатегория не может быть родителем', errors: { parentId: 'Только раздел верхнего уровня' } });
  }

  @Post('categories')
  async createCategory(@Body(new ZodPipe(categorySchema)) b: CategoryInput, @CurrentUser() admin: User) {
    await this.checkParent(null, b.parentId);
    const c = await unique(this.prisma.category.create({ data: { name: b.name, slug: b.slug || slugify(b.name) || `cat-${shortId()}`, parentId: b.parentId, slot: b.slot, position: b.position } }), 'slug');
    await this.log(admin, 'category.create', 'category', c.id, b);
    return this.all();
  }

  @Put('categories/:id')
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categorySchema)) b: CategoryInput, @CurrentUser() admin: User) {
    await this.checkParent(id, b.parentId);
    if (b.parentId && (await this.prisma.category.count({ where: { parentId: id } }))) throw new BadRequestException({ message: 'У раздела есть подкатегории — его нельзя вложить', errors: { parentId: 'Есть подкатегории' } });
    await unique(this.prisma.category.update({ where: { id }, data: { name: b.name, ...(b.slug ? { slug: b.slug } : {}), parentId: b.parentId, slot: b.slot, position: b.position } }), 'slug');
    await this.log(admin, 'category.update', 'category', id, b);
    return this.all();
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const c = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
    if (!c) throw new NotFoundException();
    if (c._count.products || c._count.children) throw inUse(`в категории ${c._count.products} товаров и ${c._count.children} подкатегорий`);
    await this.prisma.category.delete({ where: { id } });
    await this.log(admin, 'category.delete', 'category', id, { name: c.name });
    return this.all();
  }

  // ─── специальности ───────────────────────────────────────────────────

  @Post('specialty-groups')
  async createGroup(@Body(new ZodPipe(specialtyGroupSchema)) b: SpecialtyGroupInput, @CurrentUser() admin: User) {
    const g = await unique(this.prisma.specialtyGroup.create({ data: b }), 'name');
    await this.log(admin, 'group.create', 'specialty_group', g.id, b);
    return this.all();
  }

  @Put('specialty-groups/:id')
  async updateGroup(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(specialtyGroupSchema)) b: SpecialtyGroupInput, @CurrentUser() admin: User) {
    await unique(this.prisma.specialtyGroup.update({ where: { id }, data: b }), 'name');
    await this.log(admin, 'group.update', 'specialty_group', id, b);
    return this.all();
  }

  @Delete('specialty-groups/:id')
  async deleteGroup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const n = await this.prisma.specialty.count({ where: { groupId: id } });
    if (n) throw inUse(`в группе ${n} специальностей`);
    await unique(this.prisma.specialtyGroup.delete({ where: { id } }), 'name');
    await this.log(admin, 'group.delete', 'specialty_group', id);
    return this.all();
  }

  @Post('specialties')
  async createSpecialty(@Body(new ZodPipe(specialtySchema)) b: SpecialtyInput, @CurrentUser() admin: User) {
    const s = await unique(
      this.prisma.specialty.create({ data: { name: b.name, slug: b.slug || slugify(b.name) || `spec-${shortId()}`, groupId: b.groupId, position: b.position, rules: b.slots.length ? { slots: b.slots } : {} } }),
      'slug',
    );
    await this.log(admin, 'specialty.create', 'specialty', s.id, b);
    return this.all();
  }

  /** Слоты специальности определяют состав капсулы (ТЗ §8: «Подбор — слоты капсулы по специальности») */
  @Put('specialties/:id')
  async updateSpecialty(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(specialtySchema)) b: SpecialtyInput, @CurrentUser() admin: User) {
    await unique(
      this.prisma.specialty.update({ where: { id }, data: { name: b.name, ...(b.slug ? { slug: b.slug } : {}), groupId: b.groupId, position: b.position, rules: b.slots.length ? { slots: b.slots } : {} } }),
      'slug',
    );
    await this.log(admin, 'specialty.update', 'specialty', id, b);
    return this.all();
  }

  @Delete('specialties/:id')
  async deleteSpecialty(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const s = await this.prisma.specialty.findUnique({ where: { id }, include: { _count: { select: { products: true, profiles: true } } } });
    if (!s) throw new NotFoundException();
    if (s._count.products || s._count.profiles) throw inUse(`специальность у ${s._count.products} товаров и в ${s._count.profiles} анкетах`);
    await this.prisma.specialty.delete({ where: { id } });
    await this.log(admin, 'specialty.delete', 'specialty', id, { name: s.name });
    return this.all();
  }

  // ─── цвета ───────────────────────────────────────────────────────────

  @Post('colors')
  async createColor(@Body(new ZodPipe(colorSchema)) b: ColorInput, @CurrentUser() admin: User) {
    const c = await unique(this.prisma.color.create({ data: { ...b, hex: b.hex.toUpperCase() } }), 'name');
    await this.log(admin, 'color.create', 'color', c.id, b);
    return this.all();
  }

  @Put('colors/:id')
  async updateColor(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(colorSchema)) b: ColorInput, @CurrentUser() admin: User) {
    await unique(this.prisma.color.update({ where: { id }, data: { ...b, hex: b.hex.toUpperCase() } }), 'name');
    await this.log(admin, 'color.update', 'color', id, b);
    return this.all();
  }

  @Delete('colors/:id')
  async deleteColor(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const n = await this.prisma.productVariant.count({ where: { colorId: id } });
    if (n) throw inUse(`цвет у ${n} вариантов товаров`);
    await unique(this.prisma.color.delete({ where: { id } }), 'name');
    await this.log(admin, 'color.delete', 'color', id);
    return this.all();
  }

  // ─── бренды ──────────────────────────────────────────────────────────

  @Put('brands/:id')
  async updateBrand(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(brandSchema)) b: BrandInput, @CurrentUser() admin: User) {
    await unique(this.prisma.brand.update({ where: { id }, data: { name: b.name, sizeChart: b.sizeChart ?? Prisma.DbNull } }), 'name');
    await this.log(admin, 'brand.update', 'brand', id, { name: b.name, sizeChart: Boolean(b.sizeChart) });
    return this.all();
  }

  /** Дубли брендов, созданные поставщиками («Медтекс» и «МедТекс»), сливаются в один */
  @Post('brands/:id/merge')
  @HttpCode(200)
  async mergeBrand(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(brandMergeSchema)) b: { intoId: string }, @CurrentUser() admin: User) {
    if (id === b.intoId) throw new BadRequestException({ message: 'Выберите другой бренд', errors: { intoId: 'Тот же бренд' } });
    const [from, into] = await Promise.all([this.prisma.brand.findUnique({ where: { id } }), this.prisma.brand.findUnique({ where: { id: b.intoId } })]);
    if (!from || !into) throw new NotFoundException();
    const moved = await this.prisma.$transaction(async (tx) => {
      const r = await tx.product.updateMany({ where: { brandId: id }, data: { brandId: b.intoId } });
      await tx.brand.delete({ where: { id } });
      return r.count;
    });
    await this.log(admin, 'brand.merge', 'brand', b.intoId, { from: from.name, into: into.name, products: moved });
    return this.all();
  }

  @Delete('brands/:id')
  async deleteBrand(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const n = await this.prisma.product.count({ where: { brandId: id } });
    if (n) throw inUse(`у бренда ${n} товаров — объедините его с другим`);
    await unique(this.prisma.brand.delete({ where: { id } }), 'name');
    await this.log(admin, 'brand.delete', 'brand', id);
    return this.all();
  }
}
