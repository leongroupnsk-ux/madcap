import { z } from 'zod';

/** Корзина (ТЗ §6.1): строки одинаковы у гостя и у вошедшего. */
export const cartLineSchema = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
  fromCapsule: z.boolean().optional(),
});
export const cartSchema = z.object({ lines: z.array(cartLineSchema).max(100) });
export type CartLineInput = z.infer<typeof cartLineSchema>;

const phone = z
  .string()
  .transform((v) => v.replace(/[^\d+]/g, ''))
  .refine((v) => /^(\+7|8)\d{10}$/.test(v), 'Телефон в формате +7 999 123-45-67')
  .transform((v) => `+7${v.slice(-10)}`);

export const recipientSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя получателя').max(120),
  phone,
  email: z.string().trim().email('Проверьте email'),
});

export const addressSchema = z
  .object({
    type: z.enum(['pvz', 'courier']),
    cityCode: z.number().int().positive(),
    city: z.string().trim().min(1).max(120),
    street: z.string().trim().max(200).optional(),
    flat: z.string().trim().max(20).optional(),
    intercom: z.string().trim().max(20).optional(),
    entrance: z.string().trim().max(20).optional(),
    floor: z.string().trim().max(20).optional(),
    comment: z.string().trim().max(500, 'Комментарий — до 500 символов').optional(),
    pvzCode: z.string().trim().max(40).optional(),
    pvzAddress: z.string().trim().max(300).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.type === 'courier' && !a.street) ctx.addIssue({ code: 'custom', path: ['street'], message: 'Укажите улицу и дом' });
    if (a.type === 'pvz' && !a.pvzCode) ctx.addIssue({ code: 'custom', path: ['pvzCode'], message: 'Выберите пункт выдачи' });
  });
export type AddressInput = z.infer<typeof addressSchema>;

export const checkoutSchema = z.object({
  recipient: recipientSchema,
  /** Доставка по каждому поставщику: ключ — supplierId */
  delivery: z.record(z.string().uuid(), addressSchema),
  saveAddresses: z.boolean().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Ждёт оплаты',
  paid: 'Оплачен',
  cancelled: 'Отменён',
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  awaiting_payment: 'Ждёт оплаты',
  new: 'Оплачен',
  confirmed: 'Подтверждён поставщиком',
  packed: 'Упакован',
  handed_over: 'Передан в СДЭК',
  in_transit: 'В пути',
  ready_for_pickup: 'Готов к выдаче',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
  rejected: 'Отклонён поставщиком',
};

/** Порядок таймлайна отправления (ТЗ §6.6) */
export const SHIPMENT_FLOW = ['new', 'confirmed', 'packed', 'handed_over', 'in_transit', 'ready_for_pickup', 'delivered'] as const;

/** Отмена возможна до передачи в доставку */
export const CANCELLABLE_SHIPMENT = ['awaiting_payment', 'new', 'confirmed', 'packed'];

export const RETURN_DAYS = 7;

export const cdekTrackUrl = (track: string) => `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(track)}`;

/** Реквизиты получателя выплат (ТЗ §7.8): после сохранения — повторная проверка ЮKassa */
export const payoutDetailsSchema = z.object({
  legalName: z.string().trim().min(3, 'Укажите юрлицо').max(200),
  inn: z.string().trim().regex(/^\d{10}(\d{2})?$/, 'ИНН — 10 или 12 цифр'),
  account: z.string().trim().regex(/^\d{20}$/, 'Расчётный счёт — 20 цифр'),
  bik: z.string().trim().regex(/^04\d{7}$/, 'БИК — 9 цифр, начинается с 04'),
});
export type PayoutDetailsInput = z.infer<typeof payoutDetailsSchema>;

export const returnRequestSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
    .min(1, 'Выберите товары для возврата')
    .max(100)
    .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length, 'Каждый товар — одной строкой'),
  reason: z.string().trim().min(3, 'Укажите причину возврата').max(500),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Укажите причину').max(500) });

export const maskAccount = (acc: string | null | undefined) => (acc ? `•••• ${acc.slice(-4)}` : null);
