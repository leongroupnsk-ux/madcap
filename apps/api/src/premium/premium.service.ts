import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PREMIUM_BUDGETS, PREMIUM_CONTACTS, PREMIUM_LEAD_STATUSES, colorTypeOf, premiumCompleteSchema, formatRub,
  type PremiumAnswers, type PremiumCapsuleRequest, type PremiumLeadInput, type PremiumLeadStatus, type PremiumLeadUpdate,
} from '@aesculap/shared';
import type { Prisma, User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { CapsuleService, type Profile } from '../me/capsule.service';
import { shown } from '../promotions/price';
import { visibleWhere } from '../storefront/catalog.service';
import type { ImageSet } from '../common/image-keys';
import { PHOTOS, photosFor, thumbKey } from '../storefront/media-pick';

const SLOT_LABEL: Record<string, string> = { top: 'Топ', pants: 'Брюки', gown: 'Халат', shoes: 'Обувь', accessory: 'Аксессуар' };
/** Подпись варианта капсулы под заголовком (кадр .Premium-capsule) */
const VARIANT_NOTE = ['Классическое сочетание для уверенных в себе.', 'Спокойная палитра на каждый день.', 'Смелый акцент для яркой смены.'];
const MAX_ALTERNATIVES = 5;

/** «Тёмно-синий» → «Тёмно-синяя капсула», «Графит» → «Капсула «Графит»». */
export function capsuleTitle(color: string | null): string {
  if (!color) return 'Ваша капсула';
  const lower = color.toLowerCase();
  if (/(ый|ий|ой)$/.test(lower)) return `${color.replace(/(ый|ой)$/, 'ая').replace(/ий$/, 'яя')} капсула`;
  return `Капсула «${color}»`;
}

type ItemView = {
  slot: string; slotLabel: string; productId: string; variantId: string; slug: string; title: string; brand: string;
  color: string; colorHex: string; size: string; price: number; oldPrice: number | null; image: string | null; imageSet: ImageSet | null;
};

/**
 * Премиальный подбор (/premium): капсула только из товаров премиум-коллекции, считается по ответам анкеты
 * без записи в базу (гость проходит анкету без регистрации). Оплаты онлайн нет — заявка менеджеру.
 */
@Injectable()
export class PremiumService {
  private readonly logger = new Logger('Premium');

  constructor(
    private readonly prisma: PrismaService,
    private readonly capsules: CapsuleService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly mail: MailTemplatesService,
  ) {}

  // ─── ответы анкеты вошедшего покупателя ──────────────────────────────

  async answers(user: User) {
    const row = await this.prisma.premiumAnswers.findUnique({ where: { userId: user.id } });
    return { answers: (row?.answers ?? {}) as PremiumAnswers, completed: Boolean(row?.completedAt) };
  }

  /** Частичное сохранение — каждый шаг анкеты сразу, как в обычной анкете. */
  async saveAnswers(user: User, patch: PremiumAnswers, complete = false) {
    const cur = await this.answers(user);
    const answers = { ...cur.answers, ...patch };
    if (complete) this.requireComplete(answers);
    await this.prisma.premiumAnswers.upsert({
      where: { userId: user.id },
      update: { answers: answers as Prisma.InputJsonValue, ...(complete ? { completedAt: new Date() } : {}) },
      create: { userId: user.id, answers: answers as Prisma.InputJsonValue, completedAt: complete ? new Date() : null },
    });
    return this.answers(user);
  }

  private requireComplete(a: PremiumAnswers) {
    if (!premiumCompleteSchema.safeParse(a).success) throw new BadRequestException({ message: 'Сначала пройдите анкету: пол, рост и размер, место работы и бюджет' });
  }

  // ─── расчёт капсулы ──────────────────────────────────────────────────

  /** Профиль для подбора из ответов анкеты: специальности — все специальности выбранных групп. */
  private async profileOf(a: PremiumAnswers): Promise<Profile> {
    const groupIds = a.specialtyGroupIds ?? [];
    const specs = groupIds.length ? await this.prisma.specialty.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } }) : [];
    const now = new Date();
    return {
      userId: 'premium', gender: a.gender ?? null, name: a.name ?? null, age: a.age ?? null, heightCm: a.heightCm ?? null, weightKg: a.weightKg ?? null,
      sizeTop: a.sizeTop ?? null, sizeBottom: a.sizeBottom ?? null, sizeShoes: a.sizeShoes ?? null, bodyType: null,
      skinTone: a.skinTone ?? null, hair: a.hair ?? null, eyes: a.eyes ?? null, colorType: colorTypeOf(a.skinTone, a.hair),
      dressCode: null, budgetRange: null, completenessPct: 100, quizStartedAt: now, quizCompletedAt: now, updatedAt: now,
      specialties: specs.map((s) => ({ specialtyId: s.id })),
    };
  }

  /**
   * Капсула по ответам: вариант 1–3 (разные основные цвета) и замены гостя (слот → вариант товара).
   * Замена принимается, только если вещь премиальная, в наличии и подходит по размеру и ростовке.
   */
  async capsule(req: PremiumCapsuleRequest) {
    const a = req.answers;
    this.requireComplete(a);
    const p = await this.profileOf(a);
    const budgetMax = PREMIUM_BUDGETS.find((b) => b.id === a.budgetRange)?.max ?? null;
    const results = await this.capsules.compute(p, null, await this.settings.capsuleWeights(), { premium: true, budgetMax });
    const variants = results.filter((r) => r.items.some((i) => i.variantId));
    const empty = { variantNo: 1, variants: 0, title: 'Ваша капсула', note: '', size: a.sizeTop ?? null, items: [] as (ItemView & { alternatives: ItemView[] })[], count: 0, total: 0, budget: budgetMax ? budgetMax * 100 : null, overBudget: false, explanations: [] as string[] };
    if (!variants.length) return empty;
    const variantNo = Math.min(req.variantNo, variants.length);
    const v = variants[variantNo - 1];

    // Замены: проверяем по тем же жёстким фильтрам, что и подбор
    const slots = v.items.map((i) => i.slot);
    const bySlot = await this.capsules.candidates(p, slots, true);
    const eligible = (slot: string, variantId: string) => (bySlot.get(slot) ?? []).find((c) => c.variants.some((x) => x.id === variantId));
    const chosen = v.items.map((i) => {
      const override = req.overrides[i.slot as keyof typeof req.overrides];
      const ok = override && eligible(i.slot, override);
      const pick = ok ? { productId: ok.productId, variantId: override } : i.variantId ? { productId: i.productId!, variantId: i.variantId } : null;
      // Альтернативы: подобранная вещь и ранжированные варианты слота, кроме текущей
      const alts = [...(i.variantId ? [{ productId: i.productId!, variantId: i.variantId }] : []), ...i.alternatives].filter((x) => x.productId !== pick?.productId);
      return { slot: i.slot, pick, alternatives: alts.slice(0, MAX_ALTERNATIVES) };
    });

    const ids = [...new Set(chosen.flatMap((c) => [c.pick?.variantId, ...c.alternatives.map((x) => x.variantId)]).filter((x): x is string => !!x))];
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: ids }, stock: { gt: 0 }, product: { AND: [visibleWhere(), { premium: true }] } },
      include: { color: true, product: { include: { brand: true, media: PHOTOS } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const view = (slot: string, id: string): ItemView | null => {
      const r = byId.get(id);
      if (!r) return null;
      return {
        slot, slotLabel: SLOT_LABEL[slot] ?? slot, productId: r.productId, variantId: r.id, slug: r.product.slug, title: r.product.title, brand: r.product.brand.name,
        color: r.color.name, colorHex: r.color.hex, size: r.size, ...shown(r), image: this.storage.publicUrl(thumbKey(photosFor(r.product.media, r.colorId)[0])),
        imageSet: this.storage.cardSet(photosFor(r.product.media, r.colorId)[0]?.storageKey),
      };
    };
    const items = chosen
      .map((c) => {
        const item = c.pick && view(c.slot, c.pick.variantId);
        return item ? { ...item, alternatives: c.alternatives.map((x) => view(c.slot, x.variantId)).filter((x): x is ItemView => !!x) } : null;
      })
      .filter((x): x is ItemView & { alternatives: ItemView[] } => !!x);
    const total = items.reduce((s, i) => s + i.price, 0);
    const budget = budgetMax ? budgetMax * 100 : null;
    const mainColor = v.mainColorId ? await this.prisma.color.findUnique({ where: { id: v.mainColorId } }) : null;
    return {
      variantNo, variants: variants.length, title: capsuleTitle(mainColor?.name ?? null), note: VARIANT_NOTE[variantNo - 1] ?? '', size: a.sizeTop ?? null,
      items, count: items.length, total, budget, overBudget: budget !== null && total > budget, explanations: v.explanations,
    };
  }

  // ─── заявка ──────────────────────────────────────────────────────────

  async createLead(input: PremiumLeadInput, ip: string, user: User | null) {
    await this.limits.hit('premium-lead', ip, 5, 3600);
    const cap = await this.capsule({ answers: input.answers, variantNo: input.variantNo, overrides: input.overrides });
    if (!cap.items.length) throw new BadRequestException({ message: 'Капсула пуста — заявку оформить нельзя' });
    // Снимок без альтернатив: менеджеру нужен состав, цены и сумма на момент заявки
    const snapshot = {
      variantNo: cap.variantNo, title: cap.title, size: cap.size, total: cap.total, budget: cap.budget,
      items: cap.items.map(({ alternatives: _a, image: _i, ...it }) => it),
    };
    const lead = await this.prisma.premiumLead.create({
      data: {
        userId: user?.id ?? null, name: input.name, phone: input.phone, contact: input.contact, ip,
        capsule: snapshot as unknown as Prisma.InputJsonValue, answers: input.answers as Prisma.InputJsonValue,
      },
    });
    await this.audit.log(user?.id ?? null, 'premium.lead.create', 'premium_lead', lead.id, { items: snapshot.items.length, total: snapshot.total });
    if (config.alertEmail) {
      const lines = snapshot.items.map((i) => `• ${i.slotLabel}: ${i.title} (${i.brand}), ${i.color}, ${i.size} — ${formatRub(i.price)}`);
      await this.mail
        .send('premium.lead_manager', config.alertEmail, {
          'lead.name': input.name,
          'lead.phone': input.phone,
          'lead.contact': PREMIUM_CONTACTS[input.contact],
          capsule: `${snapshot.title}, вариант ${snapshot.variantNo}${snapshot.size ? `, размер ${snapshot.size}` : ''}`,
          items: lines.join('\n'),
          total: formatRub(snapshot.total),
          adminUrl: `${config.webOrigin}/admin/premium/${lead.id}`,
        })
        .catch((e) => this.logger.error(`premium lead mail: ${e.message}`));
    }
    return { id: lead.id, ok: true };
  }

  // ─── админка ─────────────────────────────────────────────────────────

  async list(status?: string) {
    const where = status && status in PREMIUM_LEAD_STATUSES ? { status: status as PremiumLeadStatus } : {};
    const [rows, counts] = await Promise.all([
      this.prisma.premiumLead.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.premiumLead.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: rows.map((l) => {
        const cap = l.capsule as { total?: number; items?: unknown[]; title?: string };
        return { id: l.id, name: l.name, phone: l.phone, contact: l.contact, status: l.status, title: cap.title ?? '', total: cap.total ?? 0, count: cap.items?.length ?? 0, createdAt: l.createdAt };
      }),
    };
  }

  async view(id: string) {
    const l = await this.prisma.premiumLead.findUnique({ where: { id }, include: { user: { select: { email: true } }, order: { select: { number: true, status: true, total: true, paymentStatus: true } } } });
    if (!l) throw new NotFoundException();
    const a = l.answers as PremiumAnswers;
    const groups = a.specialtyGroupIds?.length ? await this.prisma.specialtyGroup.findMany({ where: { id: { in: a.specialtyGroupIds } } }) : [];
    return {
      id: l.id, name: l.name, phone: l.phone, contact: l.contact, status: l.status, managerComment: l.managerComment, createdAt: l.createdAt, updatedAt: l.updatedAt,
      userEmail: l.user?.email ?? null, capsule: l.capsule, answers: a, workplaces: groups.map((g) => g.name),
      order: l.order ? { number: l.order.number, status: l.order.status, total: l.order.total } : null,
      budgetLabel: PREMIUM_BUDGETS.find((b) => b.id === a.budgetRange)?.label ?? null,
    };
  }

  async update(id: string, input: PremiumLeadUpdate, staff: User) {
    const l = await this.prisma.premiumLead.findUnique({ where: { id } });
    if (!l) throw new NotFoundException();
    await this.prisma.premiumLead.update({ where: { id }, data: { status: input.status, managerComment: input.managerComment || null } });
    await this.audit.log(staff.id, 'premium.lead.update', 'premium_lead', id, { from: l.status, to: input.status, comment: Boolean(input.managerComment) });
    return this.view(id);
  }
}
