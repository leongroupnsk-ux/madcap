import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ConsentType, User } from '@prisma/client';
import type { Request, Response } from 'express';
import { profileUpdateSchema, type ProfileUpdate } from '@aesculap/shared';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { CapsuleService } from './capsule.service';
import { PrivacyService } from './privacy.service';
import { ProfileService } from './profile.service';

const consentSchema = z.object({ type: z.enum(['pdn', 'offer', 'photos', 'marketing']), granted: z.boolean() });
const replaceSchema = z.object({ variantId: z.string().uuid() });
const deleteSchema = z.object({ password: z.string().min(1, 'Введите пароль') });
const blockSchema = z.object({ reason: z.string().trim().min(3, 'Укажите причину').max(500) });

/** Личные данные покупателя: анкета, согласия, фото, капсула (ТЗ §5, §6.5). */
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly capsules: CapsuleService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get('profile')
  profile(@CurrentUser() user: User) {
    return this.profiles.get(user);
  }

  @Put('profile')
  async update(@CurrentUser() user: User, @Body(new ZodPipe(profileUpdateSchema)) body: ProfileUpdate) {
    const res = await this.profiles.update(user, body);
    if (body.complete) await this.capsules.build(user.id);
    return res;
  }

  @Get('consents')
  consents(@CurrentUser() user: User) {
    return this.profiles.consents(user);
  }

  @Post('consents')
  @HttpCode(200)
  setConsent(@CurrentUser() user: User, @Body(new ZodPipe(consentSchema)) body: { type: ConsentType; granted: boolean }, @Req() req: Request) {
    return this.profiles.setConsent(user, body.type, body.granted, req.ip ?? 'unknown');
  }

  @Post('photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1048576, files: 1 } }))
  photo(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined, @Body('angle') angle?: string) {
    if (!file) throw new BadRequestException({ message: 'Выберите фото' });
    return this.profiles.addPhoto(user, file, angle);
  }

  @Get('photos/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'private, no-store')
  async photoFile(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.profiles.photoStream(user, id));
  }

  @Delete('photos/:id')
  deletePhoto(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.deletePhoto(user, id);
  }

  @Get('capsule')
  capsule(@CurrentUser() user: User, @Query('variant') variant?: string) {
    return this.capsules.get(user, Math.min(3, Math.max(1, Number(variant) || 1)));
  }

  @Post('capsule/rebuild')
  @HttpCode(200)
  async rebuild(@CurrentUser() user: User) {
    await this.capsules.build(user.id);
    return this.capsules.get(user, 1);
  }

  @Get('capsule/:variantNo/:slot/alternatives')
  alternatives(@CurrentUser() user: User, @Param('variantNo', ParseIntPipe) variantNo: number, @Param('slot') slot: string) {
    return this.capsules.alternatives(user, variantNo, slot);
  }

  @Put('capsule/:variantNo/:slot')
  replace(@CurrentUser() user: User, @Param('variantNo', ParseIntPipe) variantNo: number, @Param('slot') slot: string, @Body(new ZodPipe(replaceSchema)) body: { variantId: string }) {
    return this.capsules.replace(user, variantNo, slot, body.variantId);
  }

  /** Выгрузка своих данных (ст. 14 152-ФЗ) */
  @Get('export')
  async export(@CurrentUser() user: User, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Disposition': `attachment; filename="moi-dannye-${new Date().toISOString().slice(0, 10)}.json"` });
    return this.privacy.export(user.id);
  }

  /** Удаление аккаунта с подтверждением паролем */
  @Post('delete')
  @HttpCode(200)
  async remove(@CurrentUser() user: User, @Body(new ZodPipe(deleteSchema)) body: { password: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.privacy.deleteAccount(user, { password: body.password });
    res.clearCookie('sid', { path: '/' });
    return r;
  }
}

/** Пользователи в админке (ТЗ §8): поиск, блокировка, выгрузка и удаление ПДн по запросу. */
@Controller('admin/users')
@Roles('admin')
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('q') q = '') {
    const term = String(q).trim();
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, ...(term ? { OR: [{ email: { contains: term, mode: 'insensitive' } }, { phone: { contains: term } }] } : {}) },
      include: { _count: { select: { orders: true } }, supplierMembers: { include: { supplier: { select: { legalName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((u) => ({
      id: u.id, email: u.email, phone: u.phone, role: u.role, createdAt: u.createdAt, lastActiveAt: u.lastActiveAt, orders: u._count.orders,
      blockedAt: u.blockedAt, blockReason: u.blockReason, suppliers: u.supplierMembers.map((m) => m.supplier.legalName),
    }));
  }

  private async user(id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw new NotFoundException();
    return u;
  }

  @Post(':id/block')
  @HttpCode(200)
  async block(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(blockSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    const u = await this.user(id);
    if (u.id === admin.id) throw new BadRequestException({ message: 'Нельзя заблокировать себя' });
    await this.prisma.user.update({ where: { id }, data: { blockedAt: new Date(), blockReason: body.reason } });
    await this.sessions.destroyAllForUser(id);
    await this.audit.log(admin.id, 'user.block', 'user', id, { reason: body.reason });
    return { ok: true };
  }

  @Post(':id/unblock')
  @HttpCode(200)
  async unblock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    await this.user(id);
    await this.prisma.user.update({ where: { id }, data: { blockedAt: null, blockReason: null } });
    await this.audit.log(admin.id, 'user.unblock', 'user', id);
    return { ok: true };
  }

  @Get(':id/export')
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User, @Res({ passthrough: true }) res: Response) {
    await this.user(id);
    await this.audit.log(admin.id, 'user.export', 'user', id);
    res.set({ 'Content-Disposition': `attachment; filename="pdn-${id}.json"` });
    return this.privacy.export(id);
  }

  @Post(':id/delete')
  @HttpCode(200)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const u = await this.user(id);
    if (u.id === admin.id) throw new BadRequestException({ message: 'Нельзя удалить себя' });
    return this.privacy.deleteAccount(u, { byAdmin: admin });
  }
}
