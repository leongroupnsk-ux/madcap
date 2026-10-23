import type { StaffArea } from '@aesculap/shared';

/** Меню админки по роли сотрудника (ТЗ §8); сервер всё равно проверяет доступ к каждому разделу */
export const NAV: { href: string; label: string; area: StaffArea }[] = [
  { href: '/admin/orders', label: 'Заказы и платежи', area: 'orders' },
  { href: '/admin', label: 'Заявки поставщиков', area: 'suppliers' },
  { href: '/admin/moderation', label: 'Модерация товаров', area: 'moderation' },
  { href: '/admin/content', label: 'Модерация контента', area: 'moderation' },
  { href: '/admin/storefront', label: 'Витрина', area: 'catalog' },
  { href: '/admin/dictionaries', label: 'Справочники', area: 'catalog' },
  { href: '/admin/promotions', label: 'Акции', area: 'promotions' },
  { href: '/admin/payouts', label: 'Выплаты поставщиков', area: 'payouts' },
  { href: '/admin/users', label: 'Пользователи', area: 'users' },
  { href: '/admin/system', label: 'Сотрудники и настройки', area: 'system' },
];
