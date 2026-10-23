import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { STAFF_ROLES, platformSettingsSchema, staffInviteSchema, type PlatformSettings, type StaffRoleId } from '@aesculap/shared';
import type { Prisma, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { Area, Roles } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { ZodPipe } from '../common/zod.pipe';

const roleSchema = z.object({ staffRole: z.enum(['owner', 'moderator', 'editor', 'support']) });

/** Сотрудники, журнал действий и настройки платформы (ТЗ §8) — только владелец. */
@Controller('admin/system')
@Roles('admin')
@Area('system')
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('staff')
  async staff() {
    const rows = await this.prisma.user.findMany({ where: { role: 'admin', deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return rows.map((u) => ({ id: u.id, email: u.email, staffRole: u.staffRole ?? 'owner', activated: Boolean(u.emailVerifiedAt), lastActiveAt: u.lastActiveAt, blocked: Boolean(u.blockedAt), twoFactor: Boolean(u.totpEnabledAt) }));
  }

  @Post('staff')
  async invite(@Body(new ZodPipe(staffInviteSchema)) body: { email: string; staffRole: StaffRoleId }, @CurrentUser() admin: User) {
    const existing = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (existing && existing.role !== 'buyer') throw new ConflictException({ message: 'Этот email уже у сотрудника или поставщика', errors: { email: 'Уже используется' } });
    if (existing && (await this.prisma.order.count({ where: { userId: existing.id } }))) {
      throw new ConflictException({ message: 'У покупателя с этим email есть заказы — для админки заведите отдельный рабочий email', errors: { email: 'Есть заказы' } });
    }
    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data: { role: 'admin', staffRole: body.staffRole } })
      : await this.prisma.user.create({ data: { email: body.email, role: 'admin', staffRole: body.staffRole, passwordHash: await argon2.hash(randomUUID()) } });
    await this.auth.sendStaffInvite(user, STAFF_ROLES[body.staffRole]);
    await this.audit.log(admin.id, 'staff.invite', 'user', user.id, { email: body.email, staffRole: body.staffRole });
    return this.staff();
  }

  private async other(id: string, admin: User) {
    if (id === admin.id) throw new BadRequestException({ message: 'Свою роль меняет другой владелец' });
    const u = await this.prisma.user.findFirst({ where: { id, role: 'admin', deletedAt: null } });
    if (!u) throw new NotFoundException();
    return u;
  }

  /** Владелец всегда остаётся хотя бы один */
  private async keepOwner(except: string) {
    const owners = await this.prisma.user.count({ where: { role: 'admin', deletedAt: null, blockedAt: null, id: { not: except }, OR: [{ staffRole: null }, { staffRole: 'owner' }] } });
    if (!owners) throw new BadRequestException({ message: 'Должен остаться хотя бы один владелец' });
  }

  @Put('staff/:id')
  async setRole(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(roleSchema)) body: { staffRole: StaffRoleId }, @CurrentUser() admin: User) {
    const u = await this.other(id, admin);
    if (body.staffRole !== 'owner') await this.keepOwner(u.id);
    await this.prisma.user.update({ where: { id }, data: { staffRole: body.staffRole } });
    await this.audit.log(admin.id, 'staff.role', 'user', id, { from: u.staffRole ?? 'owner', to: body.staffRole });
    return this.staff();
  }

  /** Отзыв доступа: сотрудник становится обычным покупателем, сессии закрываются */
  @Post('staff/:id/revoke')
  @HttpCode(200)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const u = await this.other(id, admin);
    await this.keepOwner(u.id);
    await this.prisma.user.update({ where: { id }, data: { role: 'buyer', staffRole: null } });
    await this.sessions.destroyAllForUser(id);
    await this.audit.log(admin.id, 'staff.revoke', 'user', id, { email: u.email });
    return this.staff();
  }

  /** Журнал действий (ТЗ §8): фильтры по действию, сущности, сотруднику и дате */
  @Get('audit')
  async auditLog(@Query('action') action?: string, @Query('actor') actor?: string, @Query('entityId') entityId?: string, @Query('before') before?: string) {
    const where: Prisma.AuditLogWhereInput = {
      ...(action ? { action: { startsWith: action } } : {}),
      ...(entityId ? { entityId } : {}),
      ...(actor ? { actor: { email: { contains: actor, mode: 'insensitive' } } } : {}),
      ...(before && !Number.isNaN(Date.parse(before)) ? { at: { lt: new Date(before) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({ where, include: { actor: { select: { email: true } } }, orderBy: { at: 'desc' }, take: 100 });
    return rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor?.email ?? 'система', action: r.action, entity: r.entity, entityId: r.entityId, data: r.data }));
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  async saveSettings(@Body(new ZodPipe(platformSettingsSchema)) body: PlatformSettings, @CurrentUser() admin: User) {
    const before = await this.settings.get();
    const after = await this.settings.set(body, admin.id);
    await this.audit.log(admin.id, 'settings.update', 'platform', undefined, { before, after } as unknown as Prisma.InputJsonValue);
    return after;
  }
}
