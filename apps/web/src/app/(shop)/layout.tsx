import { CookieBanner } from '@/components/CookieBanner';
import { FavoritesSync } from '@/components/FavoritesSync';
import { Metrika } from '@/components/Metrika';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import s from '@/components/site.module.css';
import { getSessionUser } from '@/lib/session';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    // Подвал прижат к низу экрана и на коротких страницах
    <div className={s.shell}>
      <SiteHeader />
      <main className={s.main}>{children}</main>
      <SiteFooter />
      <CookieBanner />
      {/* Избранное гостя переносится в аккаунт при входе */}
      <FavoritesSync userId={user?.id ?? null} />
      {/* Яндекс Метрика: только с METRIKA_ID и после согласия на аналитические cookie */}
      <Metrika />
    </div>
  );
}
