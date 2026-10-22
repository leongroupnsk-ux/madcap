import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isValidInn } from './inn.js';

const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^\d+]/g, ''))
  .refine((v) => /^\+?\d{10,15}$/.test(v), 'Введите телефон, например +7 999 123-45-67');

export const innSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ''))
  .refine(isValidInn, 'Проверьте ИНН: 10 цифр для организации, 12 — для ИП');

/** Заявка на подключение (ТЗ §7.1). */
export const supplierApplicationSchema = z.object({
  company: z.string().trim().min(2, 'Укажите название компании').max(200),
  inn: innSchema,
  contactName: z.string().trim().min(2, 'Как к вам обращаться').max(120),
  phone: phoneSchema,
  email: emailSchema,
  assortment: z.string().trim().min(3, 'Опишите ассортимент').max(1000),
  acceptPdn: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на обработку данных' }) }),
});
export type SupplierApplicationInput = z.infer<typeof supplierApplicationSchema>;

export const rejectSchema = z.object({ reason: z.string().trim().min(3, 'Укажите причину').max(1000) });

export const SupplierMemberRole = { owner: 'owner', catalog: 'catalog', warehouse: 'warehouse' } as const;
export type SupplierMemberRole = (typeof SupplierMemberRole)[keyof typeof SupplierMemberRole];
export const MEMBER_ROLE_LABEL: Record<SupplierMemberRole, string> = {
  owner: 'Владелец',
  catalog: 'Каталог',
  warehouse: 'Склад',
};

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(['catalog', 'warehouse']),
});

/** Профиль и склад поставщика (ТЗ §7.9). */
export const supplierSettingsSchema = z.object({
  description: z.string().trim().max(500).optional().default(''),
  warehouseAddress: z.string().trim().min(5, 'Укажите адрес склада').max(300),
  cdekCityCode: z.coerce.number().int('Код города СДЭК — целое число').positive('Код города СДЭК обязателен'),
  shipDays: z.coerce.number().int().min(0).max(14),
  /** Пункт СДЭК, куда сдаются посылки: без него не создать накладную */
  cdekShipmentPoint: z.string().trim().max(40).optional().default(''),
});
export type SupplierSettingsInput = z.infer<typeof supplierSettingsSchema>;

export const ModerationStatus = { draft: 'draft', pending: 'pending', published: 'published', rejected: 'rejected', hidden: 'hidden' } as const;
export type ModerationStatus = (typeof ModerationStatus)[keyof typeof ModerationStatus];
export const MODERATION_LABEL: Record<ModerationStatus, string> = {
  draft: 'Черновик',
  pending: 'На модерации',
  published: 'Опубликован',
  rejected: 'Отклонён',
  hidden: 'Снят с витрины',
};

export const GENDER_LABEL = { female: 'Женский', male: 'Мужской', unisex: 'Унисекс' } as const;

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;
export const HEIGHT_RANGES = ['158–164', '164–170', '170–176', '176–182', '182–188'] as const;

/** Деньги в форме — рубли (с копейками), в API и БД — копейки. */
const rubles = z.coerce.number().nonnegative('Цена не может быть отрицательной').max(1_000_000);

export const variantSchema = z
  .object({
    id: z.string().uuid().optional(),
    sku: z.string().trim().min(1, 'SKU обязателен').max(64),
    size: z.string().trim().min(1, 'Размер обязателен').max(16),
    heightRange: z.string().trim().max(16).optional().nullable(),
    colorId: z.string().uuid('Выберите цвет'),
    price: rubles.refine((v) => v > 0, 'Укажите цену'),
    oldPrice: rubles.optional().nullable(),
    stock: z.coerce.number().int().min(0, 'Остаток не может быть отрицательным').max(100_000),
    weightG: z.coerce.number().int().positive('Вес обязателен для СДЭК'),
    lengthMm: z.coerce.number().int().positive('Габариты обязательны для СДЭК'),
    widthMm: z.coerce.number().int().positive('Габариты обязательны для СДЭК'),
    heightMm: z.coerce.number().int().positive('Габариты обязательны для СДЭК'),
  })
  .refine((v) => v.oldPrice == null || v.oldPrice === 0 || v.oldPrice > v.price, {
    path: ['oldPrice'],
    message: 'Старая цена должна быть выше текущей',
  });
export type VariantInput = z.infer<typeof variantSchema>;

export const productTextSchema = z.object({
  title: z.string().trim().min(2, 'Название обязательно').max(150),
  brandId: z.string().uuid('Выберите бренд'),
  categoryId: z.string().uuid('Выберите категорию'),
  gender: z.enum(['female', 'male', 'unisex']),
  fabric: z.string().trim().max(200).optional().default(''),
  treatment: z.string().trim().max(200).optional().default(''),
  washing: z.string().trim().max(200).optional().default(''),
  description: z.string().trim().max(5000).optional().default(''),
  specialtyIds: z.array(z.string().uuid()).max(20).default([]),
});

export const productMediaOrderSchema = z.object({
  order: z.array(z.string().uuid()).max(9),
  mainId: z.string().uuid().nullable(),
});

export const productSaveSchema = productTextSchema.extend({
  variants: z.array(variantSchema).max(200),
  media: productMediaOrderSchema,
});
export type ProductSaveInput = z.infer<typeof productSaveSchema>;

/** Требования к отправке на модерацию (ТЗ §7.3): минимум 3 фото и хотя бы один вариант. */
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_MB = 8;
export const MAX_VIDEO_MB = 100;
export const MAX_VIDEO_SECONDS = 60;

export const toKopecks = (rub: number) => Math.round(rub * 100);
export const toRubles = (kop: number) => kop / 100;
export const formatRub = (kop: number) => `${(kop / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

/** Склонение по числу: plural(4, 'вещь', 'вещи', 'вещей') → «вещи». */
export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
