import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import s from './site.module.css';

export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className="container">
        <div className={s.footerRow}>
          <Link href="/" style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--c-primary)' }}>
            {BRAND.mark}
          </Link>
          <Link href="/legal/offer">Оферта</Link>
          <Link href="/legal/privacy">Политика ПДн</Link>
          <Link href="/legal/delivery">Доставка и возврат</Link>
          <Link href="/legal/suppliers">Условия для поставщиков</Link>
          <Link href="/suppliers">Поставщикам</Link>
          <a href="mailto:support@example.ru">Поддержка</a>
        </div>
        {/* Реквизиты оператора площадки обязательны по ЗоЗПП — заполнить до запуска (E6-02). */}
        <div className={s.footerLegal}>© {new Date().getFullYear()} {BRAND.name}. Реквизиты оператора площадки будут указаны до запуска.</div>
      </div>
    </footer>
  );
}
