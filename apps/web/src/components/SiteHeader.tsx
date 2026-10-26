import Link from 'next/link';
import { Suspense } from 'react';
import { DEFAULT_STOREFRONT, type MenuItem } from '@aesculap/shared';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import { CartCount } from './CartCount';
import { CatalogMenu, type MegaMenuData } from './CatalogMenu';
import { CartSync } from './CartSync';
import { Logo } from './Logo';
import { SearchBox } from './shop/SearchBox';
import s from './site.module.css';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Публичные данные без сессии — кэшируются на 5 минут, чтобы шапка не ходила в API на каждой странице */
async function publicApi<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}/api${path}`, { next: { revalidate: 300 } }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

type Facet = { brands: { slug: string; name: string; count: number }[]; specialties: { id: string; name: string; count: number }[] };

/** Мегаменю: дерево категорий (2 уровня) и самые наполненные бренды и специальности из фасетов каталога. */
async function megaMenu(): Promise<MegaMenuData> {
  const [cats, list] = await Promise.all([
    publicApi<MegaMenuData['categories']>('/catalog/categories'),
    publicApi<{ facets?: Facet }>('/catalog/products?perPage=1'),
  ]);
  const top = <T extends { count: number }>(xs: T[] | undefined) => [...(xs ?? [])].sort((a, b) => b.count - a.count).slice(0, 3);
  return {
    categories: (cats ?? []).map((c) => ({ name: c.name, slug: c.slug, children: (c.children ?? []).map((ch) => ({ name: ch.name, slug: ch.slug })) })),
    brands: top(list?.facets?.brands).map((b) => ({ name: b.name, href: `/catalog?brand=${encodeURIComponent(b.slug)}` })),
    specialties: top(list?.facets?.specialties).map((sp) => ({ name: sp.name, href: `/catalog?specialty=${encodeURIComponent(sp.id)}` })),
  };
}

export async function SiteHeader() {
  const [user, menu, mega] = await Promise.all([
    getSessionUser(),
    serverApi<MenuItem[]>('/catalog/menu').then((r) => r.data ?? DEFAULT_STOREFRONT.menu),
    megaMenu(),
  ]);
  return (
    <header className={s.header}>
      <CartSync userId={user?.id ?? null} />
      <div className={`container ${s.top}`}>
        <Link href="/" className={s.logo} aria-label="aesculap — на главную">
          <Logo />
        </Link>
        {mega.categories.length > 0 ? (
          <CatalogMenu data={mega} />
        ) : (
          // API недоступен — без меню, просто ссылка на каталог
          <Link href="/catalog" className={s.catalogBtn}>
            <img src="/design/icons/catalog.svg" alt="" width={16} height={16} /> Каталог
          </Link>
        )}
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
      <div className={s.catsBar}>
        <nav className={`container ${s.cats}`} aria-label="Категории">
          {menu.map((c) => (
            <Link key={`${c.href}-${c.label}`} href={c.href} className={c.tone ? s[c.tone] : /^\/(journal|suppliers)/.test(c.href) ? s.accent : undefined}>
              {c.label}
            </Link>
          ))}
          <Link href="/map" className={s.platform}>
            Карта платформы
          </Link>
        </nav>
      </div>
    </header>
  );
}
