'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import s from '@/components/admin/shell.module.css';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';

/** Пункт меню; badge — счётчик рядом с названием (например, непрочитанные сообщения по премиум-заявкам) */
export type AdminNavItem = { href: string; label: string; badge?: number };

const SECURITY = { href: '/admin/security', label: 'Профиль и безопасность' };
const PREMIUM = '/admin/premium';

/**
 * Непрочитанные сообщения клиентов по премиум-заявкам — для бейджа у пункта «Заявки премиум».
 * Запрашивается, только если пункт есть в меню (роль с областью premium); обновляется при переходах и раз в минуту.
 */
function usePremiumUnread(enabled: boolean) {
  const path = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api<{ count: number }>('/admin/premium/unread')
        .then((r) => alive && setCount(r.count))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, path]);
  return count;
}

/** Активный пункт — самый длинный подходящий адрес: /admin/orders/… — «Заказы и платежи», /admin/system/mail-templates — «Шаблоны писем» */
function useActive(items: AdminNavItem[]) {
  const path = usePathname();
  return [...items, SECURITY]
    .filter((i) => path === i.href || path.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Счётчик в пункте меню: число в пилюле, при 0 (или без данных) не показывается. Для скринридера — «непрочитанных: N». */
export function NavBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className={s.navBadge}>
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="visually-hidden">, непрочитанных: {count}</span>
    </span>
  );
}

/**
 * Меню админки слева (как у кабинета поставщика): логотип, разделы по роли сотрудника, внизу «Профиль и безопасность»
 * и «Выйти». Активный раздел отмечен aria-current="page". На узких экранах меню сворачивается под кнопку «Меню».
 */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const path = usePathname();
  const router = useRouter();
  const active = useActive(items)?.href;
  const [open, setOpen] = useState(false);
  const premiumUnread = usePremiumUnread(items.some((i) => i.href === PREMIUM));
  // Перешли в другой раздел — свёрнутое меню закрывается
  useEffect(() => setOpen(false), [path]);
  const logout = async () => {
    await api('/auth/logout', {});
    router.replace('/login?next=/admin');
    router.refresh();
  };
  return (
    <aside className={s.side}>
      <div className={s.sideHead}>
        <div>
          <Link href="/admin" className={s.brand} aria-label={`${BRAND.name} — админка, стартовая страница`}>
            {BRAND.mark.replace(/\.$/, '')}
            <span className={s.brandDot}>.</span>
          </Link>
          <div className={s.brandSub}>Админка</div>
        </div>
        <button type="button" className={s.menuToggle} aria-expanded={open} aria-controls="admin-menu" onClick={() => setOpen((v) => !v)}>
          <span className={s.burger} aria-hidden="true" />
          Меню
        </button>
      </div>
      <div id="admin-menu" className={`${s.menu} ${open ? s.menuOpen : ''}`}>
        <nav className={s.nav} aria-label="Админка">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={n.href === active ? s.active : undefined} aria-current={n.href === active ? 'page' : undefined}>
              <span>{n.label}</span>
              <NavBadge count={n.badge ?? (n.href === PREMIUM ? premiumUnread : undefined)} />
            </Link>
          ))}
        </nav>
        <div className={s.sideFoot}>
          <Link href={SECURITY.href} aria-current={active === SECURITY.href ? 'page' : undefined}>
            {SECURITY.label}
          </Link>
          <button type="button" className={s.logout} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Название текущего раздела в шапке админки (не заголовок страницы — h1 остаётся на самой странице). */
export function AdminSection({ items }: { items: AdminNavItem[] }) {
  return <div className={s.section}>{useActive(items)?.label ?? 'Админка'}</div>;
}
