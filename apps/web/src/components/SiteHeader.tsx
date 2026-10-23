import Link from 'next/link';
import { Suspense } from 'react';
import { DEFAULT_STOREFRONT, type MenuItem } from '@aesculap/shared';
import { BRAND } from '@/lib/brand';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import { CartCount } from './CartCount';
import { CartSync } from './CartSync';
import { SearchBox } from './shop/SearchBox';
import s from './site.module.css';

export async function SiteHeader() {
  const [user, menu] = await Promise.all([getSessionUser(), serverApi<MenuItem[]>('/catalog/menu').then((r) => r.data ?? DEFAULT_STOREFRONT.menu)]);
  return (
    <header className={s.header}>
      <CartSync userId={user?.id ?? null} />
      <div className={`container ${s.top}`}>
        <Link href="/" className={s.logo}>
          {BRAND.mark}
        </Link>
        <Link href="/catalog" className={s.catalogBtn}>
          <span aria-hidden>▦</span> Каталог
        </Link>
        <Suspense>
          <SearchBox />
        </Suspense>
        <nav className={s.actions} aria-label="Аккаунт">
          {user ? (
            <Link href="/account" className={s.navLink}>
              Профиль
            </Link>
          ) : (
            <Link href="/login" className={s.navLink}>
              Войти
            </Link>
          )}
          <Link href="/cart" className={s.navLink}>
            Корзина
            <CartCount />
          </Link>
          <Link href={user?.hasCapsule ? '/capsule' : '/quiz/1'} className={s.cta}>
            {user?.hasCapsule ? 'Моя капсула' : 'Подобрать капсулу'}
          </Link>
        </nav>
      </div>
      <nav className={`container ${s.cats}`} aria-label="Категории">
        {menu.map((c) => (
          <Link key={`${c.href}-${c.label}`} href={c.href} className={c.tone ? s[c.tone] : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
