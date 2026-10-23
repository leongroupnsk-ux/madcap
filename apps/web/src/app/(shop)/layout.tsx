import { CookieBanner } from '@/components/CookieBanner';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import s from '@/components/site.module.css';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    // Подвал прижат к низу экрана и на коротких страницах
    <div className={s.shell}>
      <SiteHeader />
      <main className={s.main}>{children}</main>
      <SiteFooter />
      <CookieBanner />
    </div>
  );
}
