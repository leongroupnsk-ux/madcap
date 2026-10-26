'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { api } from '@/lib/api';
import s from './shell.module.css';

type Role = 'owner' | 'catalog' | 'warehouse';
const ITEMS: { href: string; label: string; roles?: Role[] }[] = [
  { href: '/supplier', label: 'Дашборд' },
  { href: '/supplier/products', label: 'Товары', roles: ['owner', 'catalog'] },
  { href: '/supplier/import', label: 'Импорт', roles: ['owner', 'catalog'] },
  { href: '/supplier/orders', label: 'Заказы', roles: ['owner', 'warehouse'] },
  { href: '/supplier/content', label: 'Контент', roles: ['owner', 'catalog'] },
  { href: '/supplier/promotions', label: 'Акции', roles: ['owner', 'catalog'] },
  { href: '/supplier/payouts', label: 'Выплаты', roles: ['owner'] },
  { href: '/supplier/settings', label: 'Настройки' },
];

/** Выход из кабинета — общий для меню слева и меню аккаунта в шапке. */
export function useSupplierLogout() {
  const router = useRouter();
  return async () => {
    await api('/auth/logout', {});
    router.replace('/supplier/login');
    router.refresh();
  };
}

/** Боковое меню кабинета (кадр supplier-shell): логотип, разделы по роли участника, ссылки внизу. */
export function Sidebar({ role }: { role: Role }) {
  const path = usePathname();
  const logout = useSupplierLogout();
  return (
    <aside className={s.side}>
      <Link href="/supplier" className={s.brand} aria-label={`${BRAND.name} — кабинет поставщика, дашборд`}>
        {BRAND.mark.replace(/\.$/, '')}
        <span className={s.brandDot}>.</span>
      </Link>
      <div className={s.brandSub}>Кабинет поставщика</div>
      <nav className={s.nav} aria-label="Кабинет поставщика">
        {ITEMS.filter((i) => !i.roles || i.roles.includes(role)).map((i) => {
          const active = i.href === '/supplier' ? path === i.href : path.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} className={active ? s.active : undefined} aria-current={active ? 'page' : undefined}>
              {i.label}
            </Link>
          );
        })}
      </nav>
      <div className={s.sideFoot}>
        <Link href="/map">Карта платформы</Link>
        <button type="button" className={s.logout} onClick={() => void logout()}>
          Выйти
        </button>
      </div>
    </aside>
  );
}
