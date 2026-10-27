import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BUDGETS, COLOR_TYPES, heightRangeOf, type ColorType, type StylistRequestInput } from '@aesculap/shared';
import type { StylistRequest, User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { config } from '../config';

const mine = (r: StylistRequest) => ({ id: r.id, question: r.question, sharePhotos: r.sharePhotos, status: r.status, answer: r.answer, createdAt: r.createdAt, answeredAt: r.answeredAt });

/**
 * Консультация стилиста (ТЗ §8, §11). Покупатель сам открывает запрос и решает, показывать ли фото.
 * Стилист видит анкету и фото только по открытому запросу: после ответа или отмены доступ закрывается.
 * Контакты покупателя стилисту не показываются; каждый просмотр анкеты и фото пишется в аудит.
 */
@Injectable()
export class StylistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailTemplatesService,
  ) {}

  // ─── Покупатель ───

  async list(user: User) {
    const rows = await this.prisma.stylistRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 });
    return rows.map(mine);
  }

  async create(user: User, input: StylistRequestInput) {
    const p = await this.prisma.buyerProfile.findUnique({ where: { userId: user.id }, include: { photos: { select: { id: true } } } });
    if (!p?.quizCompletedAt) throw new BadRequestException({ message: 'Сначала пройдите анкету — стилист смотрит её вместе с капсулой' });
    if (input.sharePhotos && !p.photos.length) throw new BadRequestException({ message: 'Чтобы показать фото стилисту, сначала загрузите их в профиле' });
    try {
      await this.prisma.stylistRequest.create({ data: { userId: user.id, question: input.question, sharePhotos: input.sharePhotos } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ message: 'У вас уже есть открытый запрос — стилист скоро ответит' });
      throw e;
    }
    return this.list(user);
  }

  async cancel(user: User, id: string) {
    const r = await this.prisma.stylistRequest.updateMany({ where: { id, userId: user.id, status: 'open' }, data: { status: 'cancelled' } });
    if (!r.count) throw new NotFoundException({ message: 'Открытый запрос не найден' });
    return this.list(user);
  }

  // ─── Стилист ───

  async queue(status: 'open' | 'answered' = 'open') {
    const rows = await this.prisma.stylistRequest.findMany({
      where: { status },
      include: { user: { include: { buyerProfile: { select: { name: true } } } } },
      orderBy: { createdAt: status === 'open' ? 'asc' : 'desc' },
      take: 100,
    });
    return rows.map((r) => ({ id: r.id, name: r.user.buyerProfile?.name ?? 'Покупатель', question: r.question, sharePhotos: r.sharePhotos, createdAt: r.createdAt, answeredAt: r.answeredAt }));
  }

  private async request(id: string) {
    const r = await this.prisma.stylistRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    return r;
  }

  /** Карточка запроса: анкета, капсула, фото — только пока запрос открыт */
  async view(id: string, staff: User) {
    const r = await this.request(id);
    const base = { ...mine(r), stylist: r.stylistId ? (await this.prisma.user.findUnique({ where: { id: r.stylistId }, select: { email: true } }))?.email ?? null : null };
    if (r.status !== 'open') return { ...base, profile: null, capsule: [], photos: [] };
    const p = await this.prisma.buyerProfile.findUnique({ where: { userId: r.userId }, include: { specialties: { include: { specialty: true } }, photos: { orderBy: { createdAt: 'asc' } } } });
    const capsule = await this.prisma.capsuleItem.findMany({
      where: { capsule: { userId: r.userId, variantNo: 1 } },
      include: { product: { select: { title: true, slug: true } }, variant: { include: { color: true } } },
    });
    const showPhotos = r.sharePhotos && (await this.prisma.consent.count({ where: { userId: r.userId, type: 'photos', revokedAt: null } })) > 0;
    await this.audit.log(staff.id, 'stylist.view', 'stylist_request', r.id, { photos: showPhotos ? p?.photos.length ?? 0 : 0 });
    return {
      ...base,
      profile: p && {
        name: p.name, gender: p.gender, age: p.age, heightCm: p.heightCm, heightRange: heightRangeOf(p.heightCm), weightKg: p.weightKg,
        sizeTop: p.sizeTop, sizeBottom: p.sizeBottom, sizeShoes: p.sizeShoes, bodyType: p.bodyType,
        colorType: p.colorType ? COLOR_TYPES[p.colorType as ColorType]?.label ?? p.colorType : null,
        budget: BUDGETS.find((b) => b.id === p.budgetRange)?.label ?? null,
        specialties: p.specialties.map((s) => s.specialty.name), dressCode: p.dressCode,
      },
      capsule: capsule.map((i) => ({ slot: i.slot, title: i.product?.title ?? null, slug: i.product?.slug ?? null, color: i.variant?.color.name ?? null, size: i.variant?.size ?? null })),
      photos: showPhotos ? (p?.photos ?? []).map((ph) => ({ id: ph.id, angle: ph.angle, url: `/api/admin/stylist/${r.id}/photos/${ph.id}` })) : [],
    };
  }

  async photo(id: string, photoId: string, staff: User) {
    const r = await this.request(id);
    if (r.status !== 'open' || !r.sharePhotos) throw new NotFoundException();
    if (!(await this.prisma.consent.count({ where: { userId: r.userId, type: 'photos', revokedAt: null } }))) throw new NotFoundException();
    const ph = await this.prisma.profilePhoto.findFirst({ where: { id: photoId, profileId: r.userId } });
    if (!ph) throw new NotFoundException();
    await this.audit.log(staff.id, 'stylist.photo', 'stylist_request', r.id, { photoId });
    return this.storage.stream(ph.storageKey);
  }

  async answer(id: string, answer: string, staff: User) {
    const r = await this.request(id);
    const u = await this.prisma.stylistRequest.updateMany({ where: { id, status: 'open' }, data: { status: 'answered', answer, stylistId: staff.id, answeredAt: new Date() } });
    if (!u.count) throw new BadRequestException({ message: 'Запрос уже закрыт' });
    await this.audit.log(staff.id, 'stylist.answer', 'stylist_request', id);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    if (!user.deletedAt) {
      await this.mail.send('stylist.answer', user.email, { answer, profileUrl: `${config.webOrigin}/account` });
    }
    return this.view(id, staff);
  }
}
