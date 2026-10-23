import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Logo } from './Logo';
import s from './site.module.css';

export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className="container">
        <div className={s.footerRow}>
          <Link href="/" aria-label="На главную">
            <Logo size={20} />
          </Link>
          <Link href="/legal/offer">Оферта</Link>
          <Link href="/legal/privacy">Политика ПДн</Link>
          <Link href="/legal/delivery">Доставка и возврат</Link>
          <Link href="/suppliers">Поставщикам</Link>
          <Link href="/map" className={s.footerAccent}>
            Карта платформы
          </Link>
        </div>
        {/* Реквизиты оператора площадки обязательны по ЗоЗПП — заполнить до запуска (E6-02); в макете строки нет. */}
        <div className={s.footerLegal}>© {new Date().getFullYear()} {BRAND.name}. Реквизиты оператора площадки будут указаны до запуска.</div>
      </div>
    </footer>
  );
}
