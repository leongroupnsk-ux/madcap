import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type SupplierApplicationInput, type SupplierSettingsInput } from '@aesculap/shared';
import type { Supplier, SupplierMemberRole, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../auth/auth.service';
import { LegalService } from '../common/legal.service';
import { SettingsService } from '../common/settings.service';
import { AuditService } from '../common/audit.service';
import { newToken } from '../common/crypto';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { CaptchaService } from '../common/captcha.service';
import { RateLimitService } from '../common/rate-limit.service';
import { config } from '../config';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailTemplatesService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly legal: LegalService,
    private readonly captcha: CaptchaService,
  ) {}

  async apply(input: SupplierApplicationInput, ip: string, captchaToken?: string) {
    await this.limits.hit('supplier-apply', ip, 5, 3600, this.captcha.gate(captchaToken, ip));
    const app = await this.prisma.supplierApplication.create({
      data: {
        company: input.company,
        inn: input.inn,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        assortment: input.assortment,
        ip,
      },
    });
    await this.mail.send('supplier.application_received', input.email, { contactName: input.contactName, company: input.company, consentVersion: await this.legal.consentVersion('pdn') });
    return { id: app.id };
  }

  listApplications(status?: 'new' | 'approved' | 'rejected') {
    return this.prisma.supplierApplication.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  /** Одобрение: поставщик + владелец-пользователь + письмо-приглашение. */
  async approve(id: string, admin: User) {
    const app = await this.prisma.supplierApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status !== 'new') throw new BadRequestException({ message: 'Заявка уже рассмотрена' });
    if (await this.prisma.supplier.findUnique({ where: { inn: app.inn } })) {
      throw new ConflictException({ message: `Поставщик с ИНН ${app.inn} уже подключён` });
    }

    // Комиссия нового поставщика — из настроек платформы (ТЗ §8)
    const commissionBp = Math.round((await this.settings.get()).defaultCommissionPct * 100);
    const { supplier, user, isNewUser } = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          commissionBp,
          legalName: app.company,
          inn: app.inn,
          status: 'active',
          contactName: app.contactName,
          contactPhone: app.phone,
          contactEmail: app.email,
        },
      });
      let user = await tx.user.findUnique({ where: { email: app.email } });
      const isNewUser = !user;
      if (!user) {
        // Пароль-заглушку никто не знает: вход только после установки пароля по приглашению.
        user = await tx.user.create({
          data: { email: app.email, role: 'supplier_staff', passwordHash: await argon2.hash(newToken()) },
        });
      }
      await tx.supplierMember.create({ data: { supplierId: supplier.id, userId: user.id, role: 'owner' } });
      await tx.supplierApplication.update({ where: { id }, data: { status: 'approved', reviewedAt: new Date(), supplierId: supplier.id } });
      return { supplier, user, isNewUser };
    });

    if (isNewUser) await this.auth.sendSupplierInvite(user, supplier.legalName);
    else
      await this.mail.send('supplier.approved_existing', user.email, { 'supplier.name': supplier.legalName, loginUrl: `${config.webOrigin}/supplier/login` });
    await this.audit.log(admin.id, 'supplier.approve', 'supplier_application', id, { supplierId: supplier.id });
    return supplier;
  }

  async reject(id: string, reason: string, admin: User) {
    const app = await this.prisma.supplierApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status !== 'new') throw new BadRequestException({ message: 'Заявка уже рассмотрена' });
    await this.prisma.supplierApplication.update({ where: { id }, data: { status: 'rejected', rejectReason: reason, reviewedAt: new Date() } });
    await this.mail.send('supplier.application_rejected', app.email, { contactName: app.contactName, company: app.company, reason });
    await this.audit.log(admin.id, 'supplier.reject', 'supplier_application', id, { reason });
  }

  view(supplier: Supplier) {
    return {
      id: supplier.id,
      legalName: supplier.legalName,
      inn: supplier.inn,
      status: supplier.status,
      payoutStatus: supplier.payoutStatus,
      commissionBp: supplier.commissionBp,
      description: supplier.description ?? '',
      warehouseAddress: supplier.warehouseAddress ?? '',
      cdekCityCode: supplier.cdekCityCode,
      shipDays: supplier.shipDays,
      cdekShipmentPoint: supplier.cdekShipmentPoint ?? '',
      ymlFeedUrl: supplier.ymlFeedUrl,
    };
  }

  async updateSettings(supplier: Supplier, input: SupplierSettingsInput, actor: User) {
    const updated = await this.prisma.supplier.update({
      where: { id: supplier.id },
      data: { description: input.description, warehouseAddress: input.warehouseAddress, cdekCityCode: input.cdekCityCode, shipDays: input.shipDays, cdekShipmentPoint: input.cdekShipmentPoint || null },
    });
    await this.audit.log(actor.id, 'supplier.settings', 'supplier', supplier.id, input);
    return this.view(updated);
  }

  async members(supplierId: string) {
    const rows = await this.prisma.supplierMember.findMany({ where: { supplierId }, include: { user: true }, orderBy: { role: 'asc' } });
    return rows.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role, activated: Boolean(m.user.emailVerifiedAt) }));
  }

  async invite(supplier: Supplier, email: string, role: SupplierMemberRole, actor: User) {
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (user && (await this.prisma.supplierMember.findUnique({ where: { supplierId_userId: { supplierId: supplier.id, userId: user.id } } }))) {
      throw new ConflictException({ message: 'Этот сотрудник уже есть в кабинете', errors: { email: 'Уже добавлен' } });
    }
    const isNew = !user;
    if (!user) user = await this.prisma.user.create({ data: { email, role: 'supplier_staff', passwordHash: await argon2.hash(newToken()) } });
    await this.prisma.supplierMember.create({ data: { supplierId: supplier.id, userId: user.id, role } });
    if (isNew) await this.auth.sendSupplierInvite(user, supplier.legalName);
    else
      await this.mail.send('supplier.member_access', email, { 'supplier.name': supplier.legalName, loginUrl: `${config.webOrigin}/supplier/login` });
    await this.audit.log(actor.id, 'supplier.member.invite', 'supplier', supplier.id, { email, role });
    return this.members(supplier.id);
  }

  async removeMember(supplier: Supplier, userId: string, actor: User) {
    const member = await this.prisma.supplierMember.findUnique({ where: { supplierId_userId: { supplierId: supplier.id, userId } } });
    if (!member) throw new NotFoundException();
    if (member.role === 'owner') throw new BadRequestException({ message: 'Владельца удалить нельзя' });
    await this.prisma.supplierMember.delete({ where: { supplierId_userId: { supplierId: supplier.id, userId } } });
    await this.audit.log(actor.id, 'supplier.member.remove', 'supplier', supplier.id, { userId });
    return this.members(supplier.id);
  }
}
