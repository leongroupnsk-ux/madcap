import Link from 'next/link';
import { Suspense } from 'react';
import { BRAND, CATEGORY_NAV } from '@/lib/brand';
import { getSessionUser } from '@/lib/session';
import { CartCount } from './CartCount';
import { SearchBox } from './shop/SearchBox';
import s from './site.module.css';

export async function SiteHeader() {
  const user = await getSessionUser();
  return (
    <header className={s.header}>
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
        {CATEGORY_NAV.map((c) => (
          <Link key={c.href} href={c.href} className={'tone' in c ? s[c.tone] : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
