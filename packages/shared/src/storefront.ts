import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

/** Витрина (ТЗ §8): главный блок, премиум-баннер, «Хиты недели», «Капсула недели» */
export const storefrontSchema = z.object({
  hero: z.object({
    eyebrow: text(60),
    title: text(120).min(5, 'Заголовок — от 5 символов'),
    /** Слово заголовка, выделенное курсивом */
    accent: text(40),
    text: text(300),
    cta: text(40).min(2),
  }),
  premium: z.object({ title: text(80).min(3), text: text(240), cta: text(40).min(2) }),
  /** Пусто — хиты по продажам за неделю; иначе закреплённые товары по порядку */
  hitsProductIds: z.array(z.string().uuid()).max(15),
  capsuleOfWeek: z.object({ title: text(80), text: text(240), productIds: z.array(z.string().uuid()).max(6) }),
});
export type StorefrontSettings = z.infer<typeof storefrontSchema>;

export const DEFAULT_STOREFRONT: StorefrontSettings = {
  hero: {
    eyebrow: 'Персональный подбор',
    title: 'Рабочая капсула под Вашу специальность',
    accent: 'Вашу',
    text: 'Анкета за 5 минут: специальность, размеры и рост, дресс-код клиники и бюджет. Соберём комплект формы из 5 вещей.',
    cta: 'Подобрать капсулу',
  },
  premium: { title: 'Больше, чем униформа', text: 'Продуманный дизайн, исключительный комфорт. Создано для тех, кто меняет мир к лучшему.', cta: 'Премиум коллекция' },
  hitsProductIds: [],
  capsuleOfWeek: { title: '', text: '', productIds: [] },
};

/** Веса оценки подбора капсулы (ТЗ §8: «Подбор — веса скоринга»). По умолчанию — значения v1 */
export const CAPSULE_WEIGHTS = {
  specialtyMatch: { label: 'Товар для специальности покупателя', def: 3 },
  specialtyNone: { label: 'Товар без привязки к специальностям', def: 0.5 },
  specialtyOther: { label: 'Товар для другой специальности', def: -1 },
  antibacterial: { label: 'Антибактериальная обработка', def: 1 },
  washing60: { label: 'Стирка при 60°', def: 0.5 },
  palette: { label: 'Цвет из палитры цветотипа', def: 2 },
  gownLight: { label: 'Светлый халат', def: 1.5 },
  sameColorTopPants: { label: 'Топ и брюки в основном цвете', def: 3 },
  sameColorAccessory: { label: 'Аксессуар в основном цвете', def: 2 },
} as const;
export type CapsuleWeightKey = keyof typeof CAPSULE_WEIGHTS;
export type CapsuleWeights = Record<CapsuleWeightKey, number>;
export const DEFAULT_CAPSULE_WEIGHTS = Object.fromEntries(Object.entries(CAPSULE_WEIGHTS).map(([k, v]) => [k, v.def])) as CapsuleWeights;
export const capsuleWeightsSchema = z.object(
  Object.fromEntries(Object.keys(CAPSULE_WEIGHTS).map((k) => [k, z.coerce.number().min(-10, 'От −10').max(10, 'До 10')])) as Record<CapsuleWeightKey, z.ZodNumber>,
);

/** Пробный прогон подбора в админке: анкета без сохранения (ТЗ §8) */
export const capsuleTrySchema = z.object({
  gender: z.enum(['female', 'male']),
  heightCm: z.coerce.number().int().min(140).max(210),
  sizeTop: z.string().min(1),
  sizeBottom: z.string().nullable().optional(),
  sizeShoes: z.string().nullable().optional(),
  colorType: z.enum(['spring', 'summer', 'autumn', 'winter']).nullable().optional(),
  budgetRange: z.string().nullable().optional(),
  specialtyIds: z.array(z.string().uuid()).min(1, 'Выберите специальность').max(10),
  /** Веса для прогона; без них — сохранённые */
  weights: capsuleWeightsSchema.optional(),
});
export type CapsuleTry = z.infer<typeof capsuleTrySchema>;
