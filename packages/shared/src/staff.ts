import { z } from 'zod';

/** Роли сотрудников админки (ТЗ §8). Владелец (или роль не задана) — все права. */
export const STAFF_ROLES = {
  owner: 'Владелец',
  moderator: 'Модератор',
  editor: 'Редактор',
  support: 'Поддержка',
  stylist: 'Стилист',
} as const;
export type StaffRoleId = keyof typeof STAFF_ROLES;

/** Области админки и кто, кроме владельца, в них работает */
export const STAFF_AREAS = {
  dashboard: { label: 'Дашборд платформы', roles: ['support'] },
  orders: { label: 'Заказы и платежи', roles: ['support'] },
  suppliers: { label: 'Заявки поставщиков', roles: ['moderator', 'support'] },
  moderation: { label: 'Модерация', roles: ['moderator', 'editor'] },
  catalog: { label: 'Справочники и витрина', roles: ['editor'] },
  editorial: { label: 'Журнал редакции', roles: ['editor'] },
  promotions: { label: 'Акции', roles: ['editor', 'moderator'] },
  payouts: { label: 'Выплаты поставщиков', roles: ['support'] },
  users: { label: 'Пользователи', roles: ['support'] },
  stylist: { label: 'Консультации стилиста', roles: ['stylist'] },
  premium: { label: 'Заявки премиум', roles: ['support'] },
  system: { label: 'Сотрудники, журнал, настройки', roles: [] },
} as const satisfies Record<string, { label: string; roles: StaffRoleId[] }>;
export type StaffArea = keyof typeof STAFF_AREAS;

export function canAccess(staffRole: StaffRoleId | null | undefined, area: StaffArea): boolean {
  if (!staffRole || staffRole === 'owner') return true;
  return (STAFF_AREAS[area].roles as readonly StaffRoleId[]).includes(staffRole);
}

export const staffInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Проверьте email'),
  staffRole: z.enum(['owner', 'moderator', 'editor', 'support', 'stylist']),
});

/** Настройки платформы без выкладки (ТЗ §8) */
export const platformSettingsSchema = z.object({
  defaultCommissionPct: z.coerce.number().min(0).max(30, 'Комиссия — до 30%'),
  confirmHours: z.coerce.number().int().min(12, 'Не меньше 12 часов').max(168),
  payMinutes: z.coerce.number().int().min(10, 'Не меньше 10 минут').max(120),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

/**
 * Безопасность админки: роли сотрудников, которым двухфакторный вход обязателен.
 * Владелец в списке всегда — без него владелец с украденным паролем видел бы всё.
 */
export const securitySettingsSchema = z.object({
  require2faRoles: z
    .array(z.enum(['owner', 'moderator', 'editor', 'support', 'stylist']))
    .refine((r) => r.includes('owner'), 'Для владельца 2FA обязательна')
    .transform((r) => [...new Set(r)]),
});
export type SecuritySettings = { require2faRoles: StaffRoleId[] };
export const DEFAULT_SECURITY: SecuritySettings = { require2faRoles: ['owner'] };

/** Нужна ли сотруднику настройка 2FA прямо сейчас: роль из обязательного списка, а 2FA ещё не включена. */
export function twofaSetupRequired(
  user: { role: string; staffRole?: StaffRoleId | null; totpEnabled: boolean },
  security: SecuritySettings,
): boolean {
  if (user.role !== 'admin' || user.totpEnabled) return false;
  return security.require2faRoles.includes(user.staffRole ?? 'owner');
}

/** Запрос покупателя на консультацию стилиста (ТЗ §8) */
export const stylistRequestSchema = z.object({
  question: z.string().trim().min(10, 'Опишите вопрос — от 10 символов').max(1000, 'До 1000 символов'),
  sharePhotos: z.boolean(),
});
export type StylistRequestInput = z.infer<typeof stylistRequestSchema>;

export const stylistAnswerSchema = z.object({
  answer: z.string().trim().min(20, 'Ответ — от 20 символов').max(3000, 'До 3000 символов'),
});

/**
 * Шаблон письма из админки (реестр — в API): тема и текст — обычный текст с подстановками {{order.number}}.
 * HTML не допускается: письма уходят как text/plain, а разметка в теме или тексте — признак вставки ссылки-ловушки.
 */
const noHtml = (v: string) => !/<\/?[a-z!][^>]*>/i.test(v);
export const mailTemplateSaveSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, 'Тема — от 3 символов')
    .max(200, 'Тема — до 200 символов')
    .refine((v) => !/[\r\n]/.test(v), 'Тема — одной строкой')
    .refine(noHtml, 'HTML в теме не допускается'),
  text: z.string().trim().min(10, 'Текст — от 10 символов').max(10000, 'Текст — до 10 000 символов').refine(noHtml, 'HTML не допускается — письмо уходит обычным текстом'),
});
export type MailTemplateSaveInput = z.infer<typeof mailTemplateSaveSchema>;
