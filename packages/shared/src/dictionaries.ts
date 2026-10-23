import { z } from 'zod';

/** Слоты капсулы (ТЗ §5.2) — к ним привязаны категории и правила специальностей */
export const CAPSULE_SLOTS = { top: 'Топ', pants: 'Брюки', gown: 'Халат', shoes: 'Обувь', accessory: 'Аксессуар' } as const;
export type CapsuleSlotId = keyof typeof CAPSULE_SLOTS;
const slotIds = Object.keys(CAPSULE_SLOTS) as [CapsuleSlotId, ...CapsuleSlotId[]];

/** Семейства цветов: по ним подбирается палитра цветотипа (ТЗ §5.2) */
export const COLOR_FAMILIES = {
  'neutral-light': 'Светлые нейтральные',
  'neutral-dark': 'Тёмные нейтральные',
  warm: 'Тёплые',
  green: 'Зелёные',
  teal: 'Бирюзовые',
  blue: 'Синие',
  purple: 'Фиолетовые',
} as const;
const familyIds = Object.keys(COLOR_FAMILIES) as [keyof typeof COLOR_FAMILIES, ...(keyof typeof COLOR_FAMILIES)[]];

const name = z.string().trim().min(2, 'Название — от 2 символов').max(60);
const slug = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9-]*$/, 'Только латиница, цифры и дефис')
  .optional()
  .default('');
const position = z.coerce.number().int().min(0).max(999).optional().default(0);

export const categorySchema = z.object({ name, slug, parentId: z.string().uuid().nullable().optional().default(null), slot: z.enum(slotIds).nullable().optional().default(null), position });
export const specialtyGroupSchema = z.object({ name, position });
export const specialtySchema = z.object({ name, slug, groupId: z.string().uuid('Выберите группу'), slots: z.array(z.enum(slotIds)).max(5).default([]), position });
export const colorSchema = z.object({ name, hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB'), colorFamily: z.enum(familyIds) });

const table = z.object({ columns: z.array(z.string().max(40)).min(1).max(10), rows: z.array(z.array(z.string().max(20)).max(10)).max(30) });
export const brandSchema = z.object({ name, sizeChart: z.object({ clothes: table, shoes: table }).nullable().optional().default(null) });
export const brandMergeSchema = z.object({ intoId: z.string().uuid('Выберите бренд') });

export type CategoryInput = z.infer<typeof categorySchema>;
export type SpecialtyGroupInput = z.infer<typeof specialtyGroupSchema>;
export type SpecialtyInput = z.infer<typeof specialtySchema>;
export type ColorInput = z.infer<typeof colorSchema>;
export type BrandInput = z.infer<typeof brandSchema>;
