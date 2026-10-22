import { z } from 'zod';
import { HEIGHT_RANGES, SIZES } from './supplier.js';

/** Бюджет на всю капсулу (ТЗ §5.1, шаг 5). Границы в рублях. */
export const BUDGETS = [
  { id: 'lt5', label: 'До 5 000 ₽', max: 5000 },
  { id: '5_10', label: '5 000–10 000 ₽', max: 10000 },
  { id: '10_15', label: '10 000–15 000 ₽', max: 15000 },
  { id: '15_25', label: '15 000–25 000 ₽', max: 25000 },
  { id: 'gt25', label: 'Более 25 000 ₽', max: null },
] as const;
export type BudgetId = (typeof BUDGETS)[number]['id'];

export const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] as const;

export const COLOR_TYPES = {
  spring: { label: 'Весна', families: ['warm', 'green', 'teal', 'neutral-light'] },
  summer: { label: 'Лето', families: ['blue', 'purple', 'teal', 'neutral-light'] },
  autumn: { label: 'Осень', families: ['warm', 'green', 'neutral-dark', 'teal'] },
  winter: { label: 'Зима', families: ['blue', 'neutral-dark', 'purple', 'neutral-light'] },
} as const;
export type ColorType = keyof typeof COLOR_TYPES;

/**
 * Цветотип по тону кожи и цвету волос (2×2): холодный/светлые — Лето, холодный/тёмные — Зима,
 * тёплый/светлые — Весна, тёплый/тёмные — Осень. Палитры уточняет стилист (ТЗ §5.1, шаг 3).
 */
export function colorTypeOf(skin?: string | null, hair?: string | null): ColorType | null {
  if (!skin || !hair) return null;
  if (skin === 'cold') return hair === 'light' ? 'summer' : 'winter';
  return hair === 'light' ? 'spring' : 'autumn';
}

/** Предварительный тип фигуры по разнице размеров верха и низа (подсказка на шаге 2). */
export function bodyTypeOf(top?: string | null, bottom?: string | null): string | null {
  const t = SIZES.indexOf((top ?? '') as (typeof SIZES)[number]);
  const b = SIZES.indexOf((bottom ?? '') as (typeof SIZES)[number]);
  if (t < 0 || b < 0) return null;
  if (t === b) return 'Прямоугольник';
  return t > b ? 'Перевёрнутый треугольник' : 'Треугольник';
}

/** Ростовка, в которую попадает рост; на границе — нижняя. */
export function heightRangeOf(heightCm?: number | null): string | null {
  if (!heightCm) return null;
  for (const r of HEIGHT_RANGES) {
    const [lo, hi] = r.split('–').map(Number);
    if (heightCm >= lo && heightCm <= hi) return r;
  }
  return heightCm < 158 ? HEIGHT_RANGES[0] : HEIGHT_RANGES[HEIGHT_RANGES.length - 1];
}

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

/** Обновление профиля частями — по шагам анкеты (ТЗ §5.1). */
export const profileUpdateSchema = z.object({
  gender: opt(z.enum(['female', 'male'])),
  name: opt(z.string().trim().min(1).max(60)),
  age: opt(z.coerce.number().int().min(16, 'Возраст от 16 лет').max(80, 'Возраст до 80 лет')),
  heightCm: opt(z.coerce.number().int().min(140, 'Рост от 140 см').max(210, 'Рост до 210 см')),
  weightKg: opt(z.coerce.number().int().min(35, 'Вес от 35 кг').max(200, 'Вес до 200 кг')),
  sizeTop: opt(z.enum(SIZES)),
  sizeBottom: opt(z.enum(SIZES)),
  sizeShoes: opt(z.enum(SHOE_SIZES)),
  skinTone: opt(z.enum(['warm', 'cold'])),
  hair: opt(z.enum(['light', 'dark'])),
  eyes: opt(z.enum(['light', 'dark'])),
  specialtyIds: z.array(z.string().uuid()).max(10).optional(),
  budgetRange: opt(z.enum(BUDGETS.map((b) => b.id) as [BudgetId, ...BudgetId[]])),
  dressCode: opt(z.string().trim().max(200)),
  complete: z.boolean().optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Обязательные поля по шагам — для кнопки «Далее». */
export const QUIZ_STEPS = [
  z.object({ gender: z.enum(['female', 'male'], { errorMap: () => ({ message: 'Выберите вариант' }) }), name: z.string().trim().min(1, 'Как к вам обращаться'), age: z.coerce.number({ invalid_type_error: 'Укажите возраст' }).int().min(16, 'Возраст от 16 лет').max(80, 'Возраст до 80 лет') }),
  z.object({ heightCm: z.coerce.number({ invalid_type_error: 'Укажите рост' }).int().min(140, 'Рост от 140 см').max(210, 'Рост до 210 см'), sizeTop: z.enum(SIZES, { errorMap: () => ({ message: 'Выберите размер верха' }) }) }),
  z.object({}),
  z.object({ specialtyIds: z.array(z.string()).min(1, 'Выберите хотя бы одну специальность') }),
  z.object({ budgetRange: z.string({ required_error: 'Выберите бюджет' }).min(1, 'Выберите бюджет') }),
  z.object({}),
] as const;

export const PHOTO_ANGLES = [
  { id: 'front', label: 'Анфас', hint: 'Лицом к камере, руки вдоль тела' },
  { id: 'side', label: 'Профиль (боком)', hint: 'Боком к камере, руки вдоль тела' },
  { id: 'back', label: 'Спина (со спины)', hint: 'Спиной к камере, волосы убраны' },
  { id: 'three_quarter', label: '3/4 (опционально)', hint: 'Под углом 45° к камере' },
] as const;
export const MAX_PROFILE_PHOTOS = 4;
