import { z } from 'zod';

const date = z.coerce.date({ invalid_type_error: 'Укажите дату' });

/** Акция платформы (ТЗ §8): создаёт админ */
export const promotionSchema = z
  .object({
    name: z.string().trim().min(3, 'Название — от 3 символов').max(120),
    description: z.string().trim().max(1000).optional().default(''),
    badge: z.string().trim().min(2, 'Укажите текст бейджа').max(24, 'Бейдж — до 24 символов'),
    minDiscountPct: z.coerce.number().int().min(1, 'Минимальная скидка — от 1%').max(90),
    commissionPct: z.coerce.number().min(0).max(30, 'Комиссия — до 30%'),
    applyFrom: date,
    applyTo: date,
    startsAt: date,
    endsAt: date,
    onHomepage: z.boolean().optional().default(false),
    newsletter: z.boolean().optional().default(false),
    requirements: z.string().trim().max(1000).optional().default(''),
  })
  .superRefine((p, ctx) => {
    if (p.applyTo <= p.applyFrom) ctx.addIssue({ code: 'custom', path: ['applyTo'], message: 'Приём заявок должен закончиться позже начала' });
    if (p.endsAt <= p.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Акция должна закончиться позже начала' });
    if (p.applyTo > p.endsAt) ctx.addIssue({ code: 'custom', path: ['applyTo'], message: 'Приём заявок — не позже окончания акции' });
  });
export type PromotionInput = z.infer<typeof promotionSchema>;

/** Заявка поставщика: товар и скидка; ниже минимума — не участвует (ТЗ §7.7) */
export const promotionApplySchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), discountPct: z.number().int().min(1).max(90) })).min(1).max(200),
});

export const PROMO_STATUS_LABEL: Record<string, string> = {
  approved: 'В акции',
  pending: 'На модерации',
  rejected: 'Отклонён',
  below_min: 'Скидка < минимума',
  none: 'Не участвует',
};

/** Акционная цена: округляем до рубля вверх, чтобы скидка не превышала заявленную */
export const salePriceOf = (price: number, discountPct: number) => Math.ceil((price * (100 - discountPct)) / 100 / 100) * 100;

/** События уведомлений поставщика (ТЗ §7.9) */
export const NOTIFY_EVENTS = {
  order_paid: 'Новый оплаченный заказ',
  order_overdue: 'Заказ не подтверждён 24 ч',
  capsule_zero_stock: 'Остаток 0 у товара из капсул',
  moderation: 'Итоги модерации',
  import_report: 'Отчёты импорта',
  promotion: 'Акции платформы',
  review: 'Новые отзывы на товары',
} as const;
export type NotifyEvent = keyof typeof NOTIFY_EVENTS;

export const notificationSettingsSchema = z.object({
  email: z.boolean(),
  mutedEvents: z.array(z.enum(Object.keys(NOTIFY_EVENTS) as [NotifyEvent, ...NotifyEvent[]])),
});
export const telegramLinkSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Код — 6 цифр из сообщения бота') });
