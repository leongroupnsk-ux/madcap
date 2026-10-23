import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BUDGETS, COLOR_TYPES, CapsuleSlot, heightRangeOf, type CapsuleWeights, type ColorType } from '@aesculap/shared';
import { Prisma, type BuyerProfile, type User } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { effective, shown } from '../promotions/price';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { visibleWhere } from '../storefront/catalog.service';
import { PHOTOS, photosFor, thumbKey } from '../storefront/media-pick';

const DEFAULT_SLOTS: CapsuleSlot[] = ['top', 'pants', 'gown', 'shoes', 'accessory'];
export /** Что можно не включать в капсулу ради бюджета — по порядку */
const OPTIONAL_SLOTS = ['accessory', 'shoes', 'gown'];

const SLOT_LABEL: Record<string, string> = { top: 'Топ', pants: 'Брюки', gown: 'Халат', shoes: 'Обувь', accessory: 'Аксессуар' };
const NEUTRAL_LIGHT = 'neutral-light';
const MAX_VARIANTS = 3;
const ALTERNATIVES = 4;

export type Profile = BuyerProfile & { specialties: { specialtyId: string }[] };
type Candidate = {
  productId: string;
  slot: string;
  title: string;
  specialtyIds: string[];
  treatment: string;
  washing: string;
  variants: { id: string; colorId: string; family: string; price: number; size: string; heightRange: string | null }[];
};
type Pick = { productId: string; variantId: string; price: number; colorId: string; score: number };

/**
 * Подбор капсулы v1 — правила без ML (ТЗ §5.2):
 * жёсткие фильтры (наличие в размере и ростовке, пол, видимость) → скоринг (специальность, обработка,
 * цветотип) → до 3 вариантов с разным основным цветом → укладка в бюджет → альтернативы и объяснения.
 */
@Injectable()
export class CapsuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  private async profile(userId: string): Promise<Profile | null> {
    return this.prisma.buyerProfile.findUnique({ where: { userId }, include: { specialties: true } });
  }

  private sizeFor(p: Profile, slot: string): string | null {
    if (slot === 'pants') return p.sizeBottom ?? p.sizeTop;
    if (slot === 'shoes') return p.sizeShoes;
    if (slot === 'accessory') return null;
    return p.sizeTop;
  }

  /** Кандидаты по слотам: только подходящие варианты в наличии. */
  private async candidates(p: Profile, slots: string[]): Promise<Map<string, Candidate[]>> {
    const hr = heightRangeOf(p.heightCm);
    const rows = await this.prisma.product.findMany({
      where: {
        AND: [visibleWhere(), { category: { slot: { in: slots } } }, p.gender ? { gender: { in: [p.gender, 'unisex'] } } : {}],
      },
      include: { category: true, specialties: true, variants: { where: { stock: { gt: 0 } }, include: { color: true } } },
    });
    const bySlot = new Map<string, Candidate[]>(slots.map((s) => [s, []]));
    for (const r of rows) {
      const slot = r.category.slot!;
      const size = this.sizeFor(p, slot);
      const variants = r.variants
        .filter((v) => (!size || v.size.toUpperCase() === size.toUpperCase()) && (!v.heightRange || !hr || v.heightRange === hr))
        .map((v) => ({ id: v.id, colorId: v.colorId, family: v.color.colorFamily, price: effective(v), size: v.size, heightRange: v.heightRange }));
      if (!variants.length) continue;
      bySlot.get(slot)!.push({
        productId: r.id, slot, title: r.title, specialtyIds: r.specialties.map((s) => s.specialtyId),
        treatment: (r.treatment ?? '').toLowerCase(), washing: (r.washing ?? '').toLowerCase(), variants,
      });
    }
    return bySlot;
  }

  private baseScore(c: Candidate, p: Profile, w: CapsuleWeights): number {
    const mine = new Set(p.specialties.map((s) => s.specialtyId));
    let score = 0;
    if (c.specialtyIds.some((id) => mine.has(id))) score += w.specialtyMatch;
    else if (!c.specialtyIds.length) score += w.specialtyNone;
    else score += w.specialtyOther;
    if (c.treatment.includes('антибакт')) score += w.antibacterial;
    if (c.washing.includes('60')) score += w.washing60;
    return score;
  }

  private colorScore(family: string, palette: readonly string[], slot: string, mainColor: string | null, colorId: string, w: CapsuleWeights): number {
    let s = palette.includes(family) ? w.palette : 0;
    if (slot === 'gown' && family === NEUTRAL_LIGHT) s += w.gownLight;
    if (mainColor && colorId === mainColor && (slot === 'top' || slot === 'pants')) s += w.sameColorTopPants;
    if (mainColor && colorId === mainColor && slot === 'accessory') s += w.sameColorAccessory;
    return s;
  }

  /** Лучший вариант каждого товара слота при заданном основном цвете, по убыванию оценки. */
  private ranked(cands: Candidate[], p: Profile, palette: readonly string[], mainColor: string | null, w: CapsuleWeights): Pick[] {
    return cands
      .map((c) => {
        const base = this.baseScore(c, p, w);
        const best = c.variants
          .map((v) => ({ productId: c.productId, variantId: v.id, price: v.price, colorId: v.colorId, score: base + this.colorScore(v.family, palette, c.slot, mainColor, v.colorId, w) }))
          .sort((a, b) => b.score - a.score || a.price - b.price)[0];
        return best;
      })
      .sort((a, b) => b.score - a.score || a.price - b.price);
  }

  /** Основные цвета для вариантов — цвета, в которых есть и топ, и брюки, с лучшими оценками. */
  private mainColors(bySlot: Map<string, Candidate[]>, p: Profile, palette: readonly string[], w: CapsuleWeights): (string | null)[] {
    const score = new Map<string, number>();
    for (const slot of ['top', 'pants']) {
      for (const c of bySlot.get(slot) ?? []) {
        const base = this.baseScore(c, p, w);
        for (const v of c.variants) {
          const s = base + this.colorScore(v.family, palette, slot, null, v.colorId, w) + (slot === 'pants' ? 0.1 : 0);
          score.set(`${slot}:${v.colorId}`, Math.max(score.get(`${slot}:${v.colorId}`) ?? -99, s));
        }
      }
    }
    const colors = new Set([...score.keys()].map((k) => k.split(':')[1]));
    const combined = [...colors]
      .map((id) => ({ id, both: score.has(`top:${id}`) && score.has(`pants:${id}`), s: (score.get(`top:${id}`) ?? 0) + (score.get(`pants:${id}`) ?? 0) }))
      .sort((a, b) => Number(b.both) - Number(a.both) || b.s - a.s);
    const out = combined.slice(0, MAX_VARIANTS).map((c) => c.id);
    return out.length ? out : [null];
  }

  async build(userId: string) {
    const p = await this.profile(userId);
    if (!p?.quizCompletedAt) throw new BadRequestException({ message: 'Сначала пройдите анкету' });
    await this.compute(p, userId, await this.settings.capsuleWeights());
  }

  /**
   * Расчёт капсулы. userId — сохранить у покупателя (с учётом закреплённых замен);
   * null — пробный прогон анкеты из админки без записи в базу (ТЗ §8).
   */
  async compute(p: Profile, userId: string | null, w: CapsuleWeights) {
    const results: { variantNo: number; total: number; overBudget: boolean; explanations: string[]; items: { slot: string; productId: string | null; variantId: string | null; price: number | null; score: number | null }[] }[] = [];
    const specRules = await this.prisma.specialty.findMany({ where: { id: { in: p.specialties.map((s) => s.specialtyId) } } });
    const ruleSlots = specRules.flatMap((s) => ((s.rules as { slots?: string[] } | null)?.slots ?? []));
    const slots = ruleSlots.length ? [...new Set(ruleSlots)] : DEFAULT_SLOTS;
    const palette = p.colorType ? COLOR_TYPES[p.colorType as ColorType].families : [];
    const budget = BUDGETS.find((b) => b.id === p.budgetRange)?.max ?? null;
    const bySlot = await this.candidates(p, slots);
    const pinned = userId ? await this.prisma.capsuleItem.findMany({ where: { capsule: { userId }, pinned: true }, include: { capsule: true, variant: true } }) : [];

    // Закреплённая вещь остаётся, только если всё ещё проходит жёсткие фильтры (размер, ростовка, наличие).
    const eligible = new Set([...bySlot.values()].flatMap((cs) => cs.flatMap((c) => c.variants.map((v) => v.id))));
    const mains = this.mainColors(bySlot, p, palette, w);
    if (userId) await this.prisma.capsule.deleteMany({ where: { userId, variantNo: { gt: mains.length } } });

    for (const [i, main] of mains.entries()) {
      const variantNo = i + 1;
      const ranked = new Map(slots.map((slot) => [slot, this.ranked(bySlot.get(slot) ?? [], p, palette, main, w)]));
      const chosen = new Map<string, Pick | null>(slots.map((slot) => [slot, ranked.get(slot)![0] ?? null]));
      for (const pin of pinned.filter((x) => x.capsule.variantNo === variantNo && x.variantId && eligible.has(x.variantId))) {
        chosen.set(pin.slot, { productId: pin.productId!, variantId: pin.variantId!, price: effective(pin.variant!), colorId: pin.variant!.colorId, score: 99 });
      }
      // Бюджет: пока не укладываемся — меняем самый дорогой незакреплённый слот на более дешёвую альтернативу.
      const total = () => [...chosen.values()].reduce((s, c) => s + (c?.price ?? 0), 0);
      let overBudget = false;
      if (budget) {
        for (let guard = 0; total() > budget * 100 && guard < 50; guard++) {
          const slot = [...chosen.entries()]
            .filter(([s, c]) => c && c.score < 99 && ranked.get(s)!.some((r) => r.price < c.price))
            .sort((a, b) => b[1]!.price - a[1]!.price)[0]?.[0];
          if (!slot) {
            overBudget = true;
            break;
          }
          const cur = chosen.get(slot)!;
          chosen.set(slot, ranked.get(slot)!.filter((r) => r.price < cur.price).sort((a, b) => b.score - a.score || a.price - b.price)[0]);
        }
      }
      // Не помещаемся даже в самых дешёвых вещах — убираем необязательные слоты, начиная с аксессуара.
      const dropped: string[] = [];
      if (budget && overBudget) {
        for (const slot of OPTIONAL_SLOTS) {
          if (total() <= budget * 100) break;
          const c = chosen.get(slot);
          if (c && c.score < 99) {
            chosen.set(slot, null);
            dropped.push(slot);
          }
        }
        overBudget = total() > budget * 100;
      }
      const items = slots.map((slot, position) => {
        const c = chosen.get(slot) ?? null;
        const alternatives = ranked.get(slot)!.filter((r) => r.productId !== c?.productId).slice(0, ALTERNATIVES).map((r) => ({ productId: r.productId, variantId: r.variantId }));
        return { slot, position, productId: c?.productId ?? null, variantId: c?.variantId ?? null, alternatives: alternatives as unknown as Prisma.InputJsonValue, pinned: c?.score === 99 };
      });
      const explanations = await this.explain(p, [...chosen.values()].filter((c): c is Pick => !!c), chosen, palette.length > 0, budget, overBudget);
      if (dropped.length) explanations.push(`Чтобы уложиться в бюджет, без: ${dropped.map((d) => SLOT_LABEL[d]?.toLowerCase() ?? d).join(', ')} — их можно добавить вручную`);
      results.push({
        variantNo, total: total(), overBudget, explanations,
        items: slots.map((slot) => {
          const c = chosen.get(slot) ?? null;
          return { slot, productId: c?.productId ?? null, variantId: c?.variantId ?? null, price: c?.price ?? null, score: c ? Math.round(c.score * 10) / 10 : null };
        }),
      });
      if (!userId) continue;
      await this.prisma.$transaction(async (tx) => {
        const capsule = await tx.capsule.upsert({
          where: { userId_variantNo: { userId, variantNo } },
          update: { total: total(), explanations, builtAt: new Date() },
          create: { userId, variantNo, total: total(), explanations },
        });
        await tx.capsuleItem.deleteMany({ where: { capsuleId: capsule.id } });
        await tx.capsuleItem.createMany({ data: items.map((it) => ({ ...it, capsuleId: capsule.id })) });
      });
    }
    return results;
  }

  private async explain(p: Profile, picks: Pick[], chosen: Map<string, Pick | null>, hasPalette: boolean, budget: number | null, overBudget: boolean): Promise<string[]> {
    const out: string[] = [];
    const products = await this.prisma.product.findMany({ where: { id: { in: picks.map((x) => x.productId) } }, select: { id: true, treatment: true, washing: true } });
    const colors = await this.prisma.color.findMany({ where: { id: { in: picks.map((x) => x.colorId) } } });
    const top = chosen.get('top');
    const pants = chosen.get('pants');
    const gown = chosen.get('gown');
    if (top && pants && top.colorId === pants.colorId) {
      const gownColor = gown && colors.find((c) => c.id === gown.colorId);
      out.push(`Топ и брюки — в одном цвете${gownColor ? `, халат — ${gownColor.name.toLowerCase()}` : ''}`);
    }
    if (products.length && products.every((x) => x.treatment?.toLowerCase().includes('антибакт'))) {
      out.push(`Ткань с антибактериальной обработкой${products.every((x) => x.washing?.includes('60')) ? ', стирка 60°' : ''}`);
    }
    if (hasPalette) out.push(`Палитра соответствует вашему цветотипу: ${COLOR_TYPES[p.colorType as ColorType].label}`);
    const specs = await this.prisma.specialty.findMany({ where: { id: { in: p.specialties.map((s) => s.specialtyId) } } });
    if (specs.length) out.push(`Подобрано для специальности: ${specs.map((s) => s.name).join(', ')}`);
    if (budget) out.push(overBudget ? `Не уложились в бюджет до ${budget.toLocaleString('ru-RU')} ₽ — замените вещи или измените бюджет` : `В бюджете до ${budget.toLocaleString('ru-RU')} ₽`);
    return out;
  }

  // ─── чтение и замены ─────────────────────────────────────────────────

  /** Капсула пересобирается, если анкета менялась после сборки (ТЗ §5.3). */
  async get(user: User, variantNo = 1) {
    const p = await this.profile(user.id);
    if (!p?.quizCompletedAt) return null;
    const first = await this.prisma.capsule.findFirst({ where: { userId: user.id }, orderBy: { builtAt: 'asc' } });
    if (!first || first.builtAt < p.updatedAt) await this.build(user.id);
    const variants = await this.prisma.capsule.findMany({ where: { userId: user.id }, select: { variantNo: true }, orderBy: { variantNo: 'asc' } });
    const capsule = await this.prisma.capsule.findUnique({
      where: { userId_variantNo: { userId: user.id, variantNo } },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: {
            product: { include: { brand: true, media: PHOTOS } },
            variant: { include: { color: true } },
          },
        },
      },
    });
    if (!capsule) throw new NotFoundException({ message: 'Такого варианта капсулы нет' });
    const items = capsule.items.map((it) => ({
      slot: it.slot,
      slotLabel: SLOT_LABEL[it.slot] ?? it.slot,
      pinned: it.pinned,
      alternatives: (it.alternatives as unknown[]).length,
      unavailable: !it.variant || it.variant.stock <= 0,
      product: it.product && { id: it.product.id, slug: it.product.slug, title: it.product.title, brand: it.product.brand.name, image: this.storage.publicUrl(thumbKey(photosFor(it.product.media, it.variant?.colorId)[0])) },
      variant: it.variant && { id: it.variant.id, size: it.variant.size, heightRange: it.variant.heightRange, color: it.variant.color.name, colorHex: it.variant.color.hex, ...shown(it.variant), stock: it.variant.stock },
    }));
    const available = items.filter((i) => i.variant && !i.unavailable);
    return {
      variantNo,
      variants: variants.map((v) => v.variantNo),
      items,
      count: available.length,
      total: available.reduce((s, i) => s + i.variant!.price, 0),
      explanations: capsule.explanations as string[],
      builtAt: capsule.builtAt,
    };
  }

  async alternatives(user: User, variantNo: number, slot: string) {
    const item = await this.prisma.capsuleItem.findFirst({ where: { slot, capsule: { userId: user.id, variantNo } } });
    if (!item) throw new NotFoundException();
    const alts = item.alternatives as { productId: string; variantId: string }[];
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: alts.map((a) => a.variantId) }, stock: { gt: 0 }, product: visibleWhere() },
      include: { color: true, product: { include: { brand: true, media: PHOTOS } } },
    });
    return alts
      .map((a) => variants.find((v) => v.id === a.variantId))
      .filter((v) => v !== undefined)
      .map((v) => ({
        productId: v.productId, variantId: v.id, title: v.product.title, brand: v.product.brand.name, slug: v.product.slug,
        image: this.storage.publicUrl(thumbKey(photosFor(v.product.media, v.colorId)[0])),
        color: v.color.name, colorHex: v.color.hex, size: v.size, price: effective(v),
      }));
  }

  /** Замена вещи из списка альтернатив; выбор закрепляется и переживает пересборку. */
  async replace(user: User, variantNo: number, slot: string, variantId: string) {
    const item = await this.prisma.capsuleItem.findFirst({ where: { slot, capsule: { userId: user.id, variantNo } }, include: { capsule: true } });
    if (!item) throw new NotFoundException();
    const allowed = (item.alternatives as { productId: string; variantId: string }[]).find((a) => a.variantId === variantId);
    if (!allowed) throw new BadRequestException({ message: 'Эту вещь нельзя поставить в этот слот' });
    const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, stock: { gt: 0 }, product: visibleWhere() } });
    if (!v) throw new BadRequestException({ message: 'Вещь закончилась — выберите другую' });
    const prev = item.productId && item.variantId ? [{ productId: item.productId, variantId: item.variantId }] : [];
    const alternatives = [...prev, ...(item.alternatives as { productId: string; variantId: string }[]).filter((a) => a.variantId !== variantId)].slice(0, ALTERNATIVES);
    await this.prisma.capsuleItem.update({ where: { id: item.id }, data: { productId: v.productId, variantId: v.id, pinned: true, alternatives } });
    const items = await this.prisma.capsuleItem.findMany({ where: { capsuleId: item.capsuleId }, include: { variant: true } });
    await this.prisma.capsule.update({ where: { id: item.capsuleId }, data: { total: items.reduce((s, i) => s + (i.variant ? effective(i.variant) : 0), 0) } });
    return this.get(user, variantNo);
  }

  /** «Подходит вам» на витрине (ТЗ §4.3): пол, наличие в размере профиля и специальность. */
  async fitContext(userId: string) {
    const p = await this.profile(userId);
    if (!p?.quizCompletedAt) return null;
    return { profile: p, heightRange: heightRangeOf(p.heightCm), sizeFor: (slot: string | null) => (slot ? this.sizeFor(p, slot) : p.sizeTop) };
  }
}
