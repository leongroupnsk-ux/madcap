import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { capsuleTrySchema, capsuleWeightsSchema, type CapsuleTry, type CapsuleWeights } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { ZodPipe } from '../common/zod.pipe';
import { CapsuleService, type Profile } from './capsule.service';

/** Подбор (ТЗ §8): веса скоринга и пробный прогон анкеты без сохранения. */
@Controller('admin/capsule')
@Roles('admin')
@Area('catalog')
export class AdminCapsuleController {
  constructor(
    private readonly capsule: CapsuleService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('weights')
  weights() {
    return this.settings.capsuleWeights();
  }

  @Put('weights')
  async setWeights(@Body(new ZodPipe(capsuleWeightsSchema)) body: CapsuleWeights, @CurrentUser() admin: User) {
    const r = await this.settings.setCapsuleWeights(body, admin.id);
    await this.audit.log(admin.id, 'capsule.weights', 'setting', 'capsule', body);
    return r;
  }

  @Post('try')
  @HttpCode(200)
  async try(@Body(new ZodPipe(capsuleTrySchema)) body: CapsuleTry) {
    const started = Date.now();
    const { specialtyIds, weights, ...rest } = body;
    const p = {
      userId: '', name: null, age: null, weightKg: null, bodyType: null, skinTone: null, hair: null, eyes: null, dressCode: null,
      completenessPct: 100, quizCompletedAt: new Date(), updatedAt: new Date(),
      sizeBottom: null, sizeShoes: null, colorType: null, budgetRange: null,
      ...rest,
      specialties: specialtyIds.map((specialtyId) => ({ specialtyId })),
    } as Profile;
    const variants = await this.capsule.compute(p, null, weights ?? (await this.settings.capsuleWeights()));
    const ids = [...new Set(variants.flatMap((v) => v.items.map((i) => i.variantId).filter((x): x is string => !!x)))];
    const rows = await this.prisma.productVariant.findMany({ where: { id: { in: ids } }, include: { color: true, product: { include: { brand: true } } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      ms: Date.now() - started,
      variants: variants.map((v) => ({
        ...v,
        items: v.items.map((i) => {
          const r = i.variantId ? byId.get(i.variantId) : undefined;
          return { ...i, title: r?.product.title ?? null, brand: r?.product.brand.name ?? null, color: r?.color.name ?? null, size: r?.size ?? null };
        }),
      })),
    };
  }
}
