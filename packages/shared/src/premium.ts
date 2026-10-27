import { z } from 'zod';
import { addressSchema, recipientSchema } from './orders.js';
import { SHOE_SIZES } from './profile.js';
import { SIZES } from './supplier.js';

/** Бюджет премиум-капсулы (кадр .Premium-Quiz-5). Границы в рублях. */
export const PREMIUM_BUDGETS = [
  { id: 'lt15', label: 'До 15 000 ₽', max: 15000 },
  { id: '15_20', label: '15 000–20 000 ₽', max: 20000 },
  { id: '20_25', label: '20 000–25 000 ₽', max: 25000 },
  { id: '25_30', label: '25 000–30 000 ₽', max: 30000 },
  { id: 'gt30', label: 'Более 30 000 ₽', max: null },
] as const;
export type PremiumBudgetId = (typeof PREMIUM_BUDGETS)[number]['id'];

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

/**
 * Ответы премиум-анкеты (7 шагов). Поля совпадают с обычной анкетой профиля, кроме
 * места работы (группы специальностей — карточки «Где вы работаете?») и премиального бюджета.
 */
export const premiumAnswersSchema = z.object({
  gender: opt(z.enum(['female', 'male'])),
  name: opt(z.string().trim().max(60)),
  age: opt(z.coerce.number().int().min(16, 'Возраст от 16 лет').max(80, 'Возраст до 80 лет')),
  heightCm: opt(z.coerce.number().int().min(140, 'Рост от 140 см').max(210, 'Рост до 210 см')),
  weightKg: opt(z.coerce.number().int().min(35, 'Вес от 35 кг').max(200, 'Вес до 200 кг')),
  sizeTop: opt(z.enum(SIZES)),
  sizeBottom: opt(z.enum(SIZES)),
  sizeShoes: opt(z.enum(SHOE_SIZES)),
  skinTone: opt(z.enum(['warm', 'cold'])),
  hair: opt(z.enum(['light', 'dark'])),
  eyes: opt(z.enum(['light', 'dark'])),
  specialtyGroupIds: z.array(z.string().uuid()).max(10).optional(),
  budgetRange: opt(z.enum(PREMIUM_BUDGETS.map((b) => b.id) as [PremiumBudgetId, ...PremiumBudgetId[]])),
});
export type PremiumAnswers = z.infer<typeof premiumAnswersSchema>;

/** Обязательные поля по шагам 1–6 — для кнопки «Далее»; шаг 7 — проверка всех ответов. */
export const PREMIUM_QUIZ_STEPS = [
  z.object({
    gender: z.enum(['female', 'male'], { errorMap: () => ({ message: 'Выберите вариант' }) }),
    name: z.string({ required_error: 'Как к вам обращаться' }).trim().min(1, 'Как к вам обращаться'),
    age: z.coerce.number({ invalid_type_error: 'Укажите возраст' }).int().min(16, 'Возраст от 16 лет').max(80, 'Возраст до 80 лет'),
  }),
  z.object({
    heightCm: z.coerce.number({ invalid_type_error: 'Укажите рост' }).int().min(140, 'Рост от 140 см').max(210, 'Рост до 210 см'),
    sizeTop: z.enum(SIZES, { errorMap: () => ({ message: 'Выберите размер верха' }) }),
  }),
  z.object({}),
  z.object({ specialtyGroupIds: z.array(z.string(), { required_error: 'Выберите, где вы работаете' }).min(1, 'Выберите, где вы работаете') }),
  z.object({ budgetRange: z.string({ required_error: 'Выберите бюджет' }).min(1, 'Выберите бюджет') }),
  z.object({}),
] as const;

/** Минимум для расчёта капсулы: пол, рост, размер верха, место работы и бюджет. */
export const premiumCompleteSchema = z.object({
  gender: z.enum(['female', 'male']),
  heightCm: z.number().int(),
  sizeTop: z.enum(SIZES),
  specialtyGroupIds: z.array(z.string().uuid()).min(1),
  budgetRange: z.string().min(1),
});

/** Замены вещей гостя: слот → выбранный вариант товара. Хранятся в браузере, сервер их проверяет. */
const overridesSchema = z.record(z.enum(['top', 'pants', 'gown', 'shoes', 'accessory']), z.string().uuid()).default({});

export const premiumCapsuleRequestSchema = z.object({
  answers: premiumAnswersSchema,
  variantNo: z.coerce.number().int().min(1).max(3).default(1),
  overrides: overridesSchema,
});
export type PremiumCapsuleRequest = z.infer<typeof premiumCapsuleRequestSchema>;

/** Телефон РФ: любые пробелы, скобки и дефисы, затем ровно +7 и 10 цифр. */
export const ruPhoneSchema = z
  .string({ required_error: 'Укажите телефон' })
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^\+7\d{10}$/.test(v), 'Телефон в формате +7 (999) 123-45-67');

export const PREMIUM_CONTACTS = { phone: 'Телефон', whatsapp: 'WhatsApp', telegram: 'Telegram' } as const;
export type PremiumContact = keyof typeof PREMIUM_CONTACTS;

/** Заявка «Оставить заявку» (кадр premium-call-me). Капсулу сервер пересчитывает сам по ответам и заменам. */
export const premiumLeadSchema = z.object({
  name: z.string({ required_error: 'Как к вам обращаться' }).trim().min(2, 'Имя — от 2 символов').max(60, 'Имя — до 60 символов'),
  phone: ruPhoneSchema,
  contact: z.enum(['phone', 'whatsapp', 'telegram'], { errorMap: () => ({ message: 'Выберите способ связи' }) }),
  consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие с политикой конфиденциальности' }) }),
  answers: premiumAnswersSchema,
  variantNo: z.coerce.number().int().min(1).max(3).default(1),
  overrides: overridesSchema,
});
export type PremiumLeadInput = z.infer<typeof premiumLeadSchema>;

export const PREMIUM_LEAD_STATUSES = { new: 'Новая', in_progress: 'В работе', done: 'Завершена', cancelled: 'Отменена' } as const;
export type PremiumLeadStatus = keyof typeof PREMIUM_LEAD_STATUSES;

export const premiumLeadUpdateSchema = z.object({
  status: z.enum(['new', 'in_progress', 'done', 'cancelled']),
  managerComment: z.string().trim().max(2000, 'До 2000 символов').optional().default(''),
});
export type PremiumLeadUpdate = z.infer<typeof premiumLeadUpdateSchema>;

/**
 * «Создать заказ» из премиум-заявки: получатель (email обязателен — туда уйдёт ссылка на оплату), доставка по
 * отправлениям как в оформлении (ключ — supplierId) и варианты из снимка капсулы, которые идут в заказ.
 */
export const premiumOrderSchema = z.object({
  recipient: recipientSchema,
  delivery: z.record(z.string().uuid(), addressSchema),
  variantIds: z.array(z.string().uuid()).min(1, 'Выберите хотя бы одну вещь').max(20),
});
export type PremiumOrderInput = z.infer<typeof premiumOrderSchema>;
export const premiumQuoteSchema = z.object({ cityCode: z.number().int().positive(), variantIds: z.array(z.string().uuid()).min(1).max(20) });

// ─── переписка по заявке ────────────────────────────────────────────────

/** Сколько дней живёт одноразовая ссылка привязки Telegram из заявки */
export const PREMIUM_TELEGRAM_LINK_DAYS = 7;

export const PREMIUM_MESSAGE_CHANNELS = { telegram: 'Telegram', whatsapp: 'WhatsApp', note: 'Заметка' } as const;
export const PREMIUM_MESSAGE_STATUSES = { sent: 'Отправлено', failed: 'Не доставлено', received: 'Получено', offline: 'Вне системы' } as const;
export type PremiumMessageStatus = keyof typeof PREMIUM_MESSAGE_STATUSES;

/**
 * Сообщение менеджера в ленте заявки: telegram — уходит клиенту через бота платформы,
 * whatsapp — заметка «написал в WhatsApp: …» (официального API нет, отправлено вне системы).
 */
export const premiumMessageSchema = z.object({
  channel: z.enum(['telegram', 'whatsapp'], { errorMap: () => ({ message: 'Выберите канал' }) }),
  text: z.string({ required_error: 'Введите текст' }).trim().min(1, 'Введите текст').max(4000, 'До 4000 символов'),
});
export type PremiumMessageInput = z.infer<typeof premiumMessageSchema>;

/** Номер заявки для клиента: «№ 12» */
export const premiumLeadNo = (no: number) => `№ ${no}`;

/** Приветствие в WhatsApp: ссылка wa.me с готовым текстом (официального API нет — менеджер пишет из своего WhatsApp) */
export function premiumWhatsappUrl(phone: string, name: string, no: number, brand: string) {
  const text = `Здравствуйте, ${name}! Это менеджер ${brand}, пишу по вашей заявке ${premiumLeadNo(no)} на премиум-капсулу.`;
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
