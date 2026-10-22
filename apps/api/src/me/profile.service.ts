import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BUDGETS, COLOR_TYPES, CONSENT_VERSIONS, MAX_PROFILE_PHOTOS, bodyTypeOf, colorTypeOf, heightRangeOf, type ProfileUpdate } from '@aesculap/shared';
import type { BuyerProfile, ConsentType, PhotoAngle, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';

const COMPLETENESS_FIELDS = ['gender', 'name', 'age', 'heightCm', 'weightKg', 'sizeTop', 'sizeBottom', 'sizeShoes', 'colorType', 'budgetRange'] as const;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async ensure(userId: string) {
    return this.prisma.buyerProfile.upsert({ where: { userId }, update: {}, create: { userId }, include: { specialties: true, photos: true } });
  }

  async get(user: User) {
    const p = await this.ensure(user.id);
    return this.view(p, p.specialties.map((s) => s.specialtyId), p.photos);
  }

  view(p: BuyerProfile, specialtyIds: string[], photos: { id: string; angle: PhotoAngle | null }[]) {
    const ct = p.colorType as keyof typeof COLOR_TYPES | null;
    return {
      gender: p.gender, name: p.name, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg,
      sizeTop: p.sizeTop, sizeBottom: p.sizeBottom, sizeShoes: p.sizeShoes, heightRange: heightRangeOf(p.heightCm),
      skinTone: p.skinTone, hair: p.hair, eyes: p.eyes, colorType: ct, colorTypeLabel: ct ? COLOR_TYPES[ct].label : null,
      bodyType: p.bodyType, specialtyIds, budgetRange: p.budgetRange, budgetLabel: BUDGETS.find((b) => b.id === p.budgetRange)?.label ?? null,
      dressCode: p.dressCode, completenessPct: p.completenessPct, quizCompleted: Boolean(p.quizCompletedAt),
      photos: photos.map((ph) => ({ id: ph.id, angle: ph.angle, url: `/api/me/photos/${ph.id}` })),
    };
  }

  /** Частичное обновление: каждый шаг анкеты сохраняется сразу (ТЗ §5.1). */
  async update(user: User, input: ProfileUpdate) {
    const current = await this.ensure(user.id);
    const { specialtyIds, complete, ...fields } = input;
    const merged = { ...current, ...fields } as BuyerProfile;
    if (specialtyIds) {
      const found = await this.prisma.specialty.count({ where: { id: { in: specialtyIds } } });
      if (found !== new Set(specialtyIds).size) throw new BadRequestException({ message: 'Неизвестная специальность', errors: { specialtyIds: 'Неизвестная специальность' } });
    }
    const specCount = specialtyIds ? specialtyIds.length : current.specialties.length;
    const colorType = colorTypeOf(merged.skinTone, merged.hair);
    const bodyType = bodyTypeOf(merged.sizeTop, merged.sizeBottom);
    const filled = COMPLETENESS_FIELDS.filter((k) => (k === 'colorType' ? colorType : merged[k]) != null).length + (specCount ? 1 : 0) + (current.photos.length ? 1 : 0);
    const completenessPct = Math.round((filled / (COMPLETENESS_FIELDS.length + 2)) * 100);

    if (complete) {
      const missing: string[] = [];
      if (!merged.gender) missing.push('пол');
      if (!merged.heightCm || !merged.sizeTop) missing.push('рост и размер');
      if (!specCount) missing.push('специальность');
      if (!merged.budgetRange) missing.push('бюджет');
      if (missing.length) throw new BadRequestException({ message: `Заполните: ${missing.join(', ')}` });
    }

    await this.prisma.$transaction([
      this.prisma.buyerProfile.update({
        where: { userId: user.id },
        data: { ...fields, colorType, bodyType, completenessPct, ...(complete ? { quizCompletedAt: current.quizCompletedAt ?? new Date() } : {}) },
      }),
      ...(specialtyIds
        ? [
            this.prisma.profileSpecialty.deleteMany({ where: { profileId: user.id } }),
            this.prisma.profileSpecialty.createMany({ data: specialtyIds.map((specialtyId) => ({ profileId: user.id, specialtyId })) }),
          ]
        : []),
    ]);
    return this.get(user);
  }

  // ─── согласия ────────────────────────────────────────────────────────

  async consents(user: User) {
    const rows = await this.prisma.consent.findMany({ where: { userId: user.id, revokedAt: null } });
    return Object.fromEntries((['pdn', 'offer', 'photos', 'marketing'] as ConsentType[]).map((t) => [t, rows.some((r) => r.type === t)]));
  }

  /** Отзыв согласия на фото удаляет все фото (ТЗ §6.5, §11). */
  async setConsent(user: User, type: ConsentType, granted: boolean, ip: string) {
    if (type === 'pdn' || type === 'offer') {
      if (!granted) throw new BadRequestException({ message: 'Отзыв согласия на обработку ПДн — это удаление аккаунта. Напишите в поддержку.' });
    }
    const active = await this.prisma.consent.findFirst({ where: { userId: user.id, type, revokedAt: null } });
    if (granted && !active) await this.prisma.consent.create({ data: { userId: user.id, type, version: CONSENT_VERSIONS[type], ip } });
    if (!granted && active) {
      await this.prisma.consent.updateMany({ where: { userId: user.id, type, revokedAt: null }, data: { revokedAt: new Date() } });
      if (type === 'photos') await this.deleteAllPhotos(user);
    }
    await this.audit.log(user.id, granted ? 'consent.grant' : 'consent.revoke', 'user', user.id, { type });
    return this.consents(user);
  }

  // ─── фото (приватные) ────────────────────────────────────────────────

  async addPhoto(user: User, file: { buffer: Buffer; mimetype: string }, angle?: string) {
    const consent = await this.prisma.consent.findFirst({ where: { userId: user.id, type: 'photos', revokedAt: null } });
    if (!consent) throw new ForbiddenException({ message: 'Сначала дайте согласие на обработку и хранение фото' });
    const profile = await this.ensure(user.id);
    if (profile.photos.length >= MAX_PROFILE_PHOTOS) throw new BadRequestException({ message: `Не больше ${MAX_PROFILE_PHOTOS} фото` });
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) throw new BadRequestException({ message: 'Нужно фото JPG, PNG или HEIC' });
    if (file.buffer.length > 10 * 1048576) throw new BadRequestException({ message: 'Фото больше 10 МБ' });
    let data: Buffer;
    try {
      // rotate() применяет ориентацию, а метаданные (EXIF, геометки) sharp не переносит.
      data = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException({ message: 'Файл не похож на фото' });
    }
    const id = randomUUID();
    const key = `private/profiles/${user.id}/${id}.webp`;
    await this.storage.put(key, data);
    const validAngle = ['front', 'side', 'back', 'three_quarter'].includes(angle ?? '') ? (angle as PhotoAngle) : null;
    await this.prisma.profilePhoto.create({ data: { id, profileId: user.id, storageKey: key, angle: validAngle } });
    return this.update(user, {});
  }

  /** Фото видит только владелец (ТЗ §11). */
  async photoStream(user: User, id: string) {
    const photo = await this.prisma.profilePhoto.findFirst({ where: { id, profileId: user.id } });
    if (!photo) throw new NotFoundException();
    return this.storage.stream(photo.storageKey);
  }

  async deletePhoto(user: User, id: string) {
    const photo = await this.prisma.profilePhoto.findFirst({ where: { id, profileId: user.id } });
    if (!photo) throw new NotFoundException();
    await this.prisma.profilePhoto.delete({ where: { id } });
    await this.storage.remove(photo.storageKey);
    return this.update(user, {});
  }

  private async deleteAllPhotos(user: User) {
    const photos = await this.prisma.profilePhoto.findMany({ where: { profileId: user.id } });
    await this.prisma.profilePhoto.deleteMany({ where: { profileId: user.id } });
    for (const p of photos) await this.storage.remove(p.storageKey);
  }
}
