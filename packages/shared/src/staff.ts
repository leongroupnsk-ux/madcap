import { z } from 'zod';

/** Роли сотрудников админки (ТЗ §8). Владелец (или роль не задана) — все права. */
export const STAFF_ROLES = {
  owner: 'Владелец',
  moderator: 'Модератор',
  editor: 'Редактор',
  support: 'Поддержка',
} as const;
export type StaffRoleId = keyof typeof STAFF_ROLES;

/** Области админки и кто, кроме владельца, в них работает */
export const STAFF_AREAS = {
  orders: { label: 'Заказы и платежи', roles: ['support'] },
  suppliers: { label: 'Заявки поставщиков', roles: ['moderator', 'support'] },
  moderation: { label: 'Модерация', roles: ['moderator', 'editor'] },
  catalog: { label: 'Справочники', roles: ['editor'] },
  promotions: { label: 'Акции', roles: ['editor', 'moderator'] },
  payouts: { label: 'Выплаты поставщиков', roles: ['support'] },
  users: { label: 'Пользователи', roles: ['support'] },
  system: { label: 'Сотрудники, журнал, настройки', roles: [] },
} as const satisfies Record<string, { label: string; roles: StaffRoleId[] }>;
export type StaffArea = keyof typeof STAFF_AREAS;

export function canAccess(staffRole: StaffRoleId | null | undefined, area: StaffArea): boolean {
  if (!staffRole || staffRole === 'owner') return true;
  return (STAFF_AREAS[area].roles as readonly StaffRoleId[]).includes(staffRole);
}

export const staffInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Проверьте email'),
  staffRole: z.enum(['owner', 'moderator', 'editor', 'support']),
});

/** Настройки платформы без выкладки (ТЗ §8) */
export const platformSettingsSchema = z.object({
  defaultCommissionPct: z.coerce.number().min(0).max(30, 'Комиссия — до 30%'),
  confirmHours: z.coerce.number().int().min(12, 'Не меньше 12 часов').max(168),
  payMinutes: z.coerce.number().int().min(10, 'Не меньше 10 минут').max(120),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
