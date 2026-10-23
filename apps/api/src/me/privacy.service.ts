import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { JobsService } from '../common/jobs.service';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { config } from '../config';

const DAY = 86400000;
/** Фото хранятся до отзыва согласия или 12 месяцев без активности (ТЗ §11) */
const PHOTO_RETENTION_DAYS = 365;
const IN_PROGRESS = ['new', 'confirmed', 'packed', 'handed_over', 'in_transit', 'ready_for_pickup'] as const;

/**
 * Права субъекта ПДн (152-ФЗ, ТЗ §11): выгрузка своих данных, удаление аккаунта с обезличиванием
 * (заказы остаются для бухучёта), автоудаление фото по сроку хранения.
 */
@Injectable()
export class PrivacyService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Privacy');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly jobs: JobsService,
  ) {}

  async onApplicationBootstrap() {
    this.jobs.register('privacy.photos', async () => void (await this.expirePhotos()));
    await this.jobs.repeat('privacy.photos', DAY);
  }

  /** Всё, что платформа хранит о пользователе, — одним JSON (ст. 14 152-ФЗ). */
  async export(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        consents: { orderBy: { grantedAt: 'asc' } },
        buyerProfile: { include: { specialties: { include: { specialty: true } }, photos: true } },
        capsules: { include: { items: { include: { product: { select: { title: true } } } } } },
        addresses: true,
        orders: { include: { shipments: { include: { items: true } } }, orderBy: { createdAt: 'asc' } },
        sessions: { select: { createdAt: true, lastSeenAt: true, userAgent: true, ip: true } },
      },
    });
    if (!u) throw new NotFoundException();
    const p = u.buyerProfile;
    return {
      exportedAt: new Date(),
      operator: config.brandName,
      account: { email: u.email, phone: u.phone, role: u.role, createdAt: u.createdAt, emailVerifiedAt: u.emailVerifiedAt, lastActiveAt: u.lastActiveAt, twoFactor: Boolean(u.totpEnabledAt) },
      consents: u.consents.map((c) => ({ type: c.type, version: c.version, grantedAt: c.grantedAt, revokedAt: c.revokedAt, ip: c.ip })),
      profile: p && {
        gender: p.gender, name: p.name, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, sizeTop: p.sizeTop, sizeBottom: p.sizeBottom, sizeShoes: p.sizeShoes,
        skinTone: p.skinTone, hair: p.hair, eyes: p.eyes, colorType: p.colorType, bodyType: p.bodyType, budgetRange: p.budgetRange,
        specialties: p.specialties.map((s) => s.specialty.name),
        photos: p.photos.map((ph) => ({ angle: ph.angle, uploadedAt: ph.createdAt, note: 'файл выдаётся по запросу в поддержку' })),
      },
      capsules: u.capsules.map((c) => ({ variant: c.variantNo, total: c.total / 100, builtAt: c.builtAt, items: c.items.map((i) => i.product?.title ?? null).filter(Boolean) })),
      addresses: u.addresses.map(({ userId: _u, id: _i, ...a }) => a),
      orders: u.orders.map((o) => ({
        number: o.number, createdAt: o.createdAt, status: o.status, total: o.total / 100,
        recipient: { name: o.recipientName, phone: o.recipientPhone, email: o.recipientEmail },
        shipments: o.shipments.map((s) => ({ no: s.no, status: s.status, address: s.address, items: s.items.map((i) => ({ title: i.title, size: i.size, qty: i.qty, price: i.price / 100 })) })),
      })),
      sessions: u.sessions,
    };
  }

  /**
   * Удаление аккаунта (ТЗ §6.5, §11): профиль, фото, капсулы, адреса и корзина удаляются, учётная запись
   * обезличивается, заказы остаются для бухгалтерского учёта.
   */
  async deleteAccount(user: User, opts: { password?: string; byAdmin?: User }) {
    if (!opts.byAdmin) {
      if (!opts.password || !(await argon2.verify(user.passwordHash, opts.password).catch(() => false))) {
        throw new UnauthorizedException({ message: 'Неверный пароль', errors: { password: 'Неверный пароль' } });
      }
      if (user.role !== 'buyer') throw new ForbiddenException({ message: 'Аккаунт сотрудника поставщика удаляется через владельца кабинета или поддержку' });
    }
    const active = await this.prisma.shipment.count({ where: { order: { userId: user.id }, status: { in: [...IN_PROGRESS] } } });
    if (active) throw new BadRequestException({ message: 'Есть заказы в пути. Удалить аккаунт можно после их получения или отмены.' });

    const photos = await this.prisma.profilePhoto.findMany({ where: { profileId: user.id } });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.buyerProfile.deleteMany({ where: { userId: user.id } }),
      this.prisma.capsule.deleteMany({ where: { userId: user.id } }),
      this.prisma.cartItem.deleteMany({ where: { userId: user.id } }),
      this.prisma.address.deleteMany({ where: { userId: user.id } }),
      this.prisma.notification.deleteMany({ where: { userId: user.id } }),
      this.prisma.notificationSetting.deleteMany({ where: { userId: user.id } }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
      this.prisma.authToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.supplierMember.deleteMany({ where: { userId: user.id } }),
      this.prisma.consent.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { email: `deleted-${user.id}@deleted.invalid`, passwordHash: `!${randomUUID()}`, phone: null, totpSecret: null, totpEnabledAt: null, deletedAt: now },
      }),
    ]);
    // Неоплаченные заказы отменит таймер оплаты и вернёт резерв; файлы фото удаляем сразу.
    for (const ph of photos) await this.storage.remove(ph.storageKey).catch(() => undefined);
    await this.audit.log(opts.byAdmin?.id ?? user.id, opts.byAdmin ? 'user.delete.admin' : 'user.delete', 'user', user.id, { photos: photos.length });
    await this.mail.send({ to: user.email, subject: `Аккаунт удалён — ${config.brandName}`, text: 'Ваш аккаунт и персональные данные профиля удалены. Сведения о заказах хранятся для бухгалтерского учёта.' }).catch(() => undefined);
    return { ok: true };
  }

  /** Раз в сутки: фото пользователей без активности дольше 12 месяцев удаляются. */
  async expirePhotos(now = new Date()) {
    const stale = await this.prisma.profilePhoto.findMany({
      where: { profile: { user: { lastActiveAt: { lt: new Date(now.getTime() - PHOTO_RETENTION_DAYS * DAY) } } } },
      include: { profile: { include: { user: true } } },
      take: 1000,
    });
    const users = new Map<string, string>();
    for (const ph of stale) {
      await this.prisma.profilePhoto.delete({ where: { id: ph.id } });
      await this.storage.remove(ph.storageKey).catch(() => undefined);
      users.set(ph.profile.userId, ph.profile.user.email);
    }
    for (const [id, email] of users) {
      await this.audit.log(null, 'privacy.photos.expired', 'user', id);
      await this.mail.send({ to: email, subject: `Фото удалены — ${config.brandName}`, text: 'Вы не заходили в аккаунт больше года, поэтому фото из анкеты удалены, как обещано в согласии. Профиль и заказы сохранены.' }).catch(() => undefined);
    }
    if (stale.length) this.logger.log(`Удалено фото по сроку хранения: ${stale.length}`);
    return { photos: stale.length, users: users.size };
  }
}
