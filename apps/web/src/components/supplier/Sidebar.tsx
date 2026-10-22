'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { api } from '@/lib/api';
import s from './cabinet.module.css';

type Role = 'owner' | 'catalog' | 'warehouse';
const ITEMS: { href: string; label: string; roles?: Role[]; soon?: string }[] = [
  { href: '/supplier', label: 'Дашборд' },
  { href: '/supplier/products', label: 'Товары', roles: ['owner', 'catalog'] },
  { href: '/supplier/import', label: 'Импорт', roles: ['owner', 'catalog'] },
  { href: '/supplier/orders', label: 'Заказы', soon: 'этап 4' },
  { href: '/supplier/content', label: 'Контент', roles: ['owner', 'catalog'] },
  { href: '/supplier/promotions', label: 'Акции', soon: 'этап 5' },
  { href: '/supplier/payouts', label: 'Выплаты', soon: 'этап 4' },
  { href: '/supplier/settings', label: 'Настройки' },
];

export function Sidebar({ role }: { role: Role }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <aside className={s.side}>
      <Link href="/supplier" className={s.brand}>
        {BRAND.mark}
        <span className={s.brandSub}>Кабинет поставщика</span>
      </Link>
      <nav className={s.nav} aria-label="Кабинет поставщика">
        {ITEMS.filter((i) => !i.roles || i.roles.includes(role)).map((i) =>
          i.soon ? (
            <span key={i.href} className={s.soon} title={`Появится на ${i.soon}`}>
              {i.label} <span className={s.soonTag}>скоро</span>
            </span>
          ) : (
            <Link key={i.href} href={i.href} className={(i.href === '/supplier' ? path === i.href : path.startsWith(i.href)) ? s.active : undefined}>
              {i.label}
            </Link>
          ),
        )}
      </nav>
      <div className={s.sideFoot}>
        <Link href="/" style={{ color: 'var(--c-text-muted)', textDecoration: 'none' }}>
          На витрину
        </Link>
        <button
          onClick={async () => {
            await api('/auth/logout', {});
            router.replace('/supplier/login');
            router.refresh();
          }}
        >
          Выйти
        </button>
      </div>
    </aside>
  );
}
