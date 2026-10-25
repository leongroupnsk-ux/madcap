import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RoleSwitch } from '@/components/auth/AuthCard';
import s from '@/components/supplier/public.module.css';
import { BRAND } from '@/lib/brand';
import { serverApi } from '@/lib/server-api';
import { SupplierLoginForm } from './SupplierLoginForm';

export const metadata: Metadata = { title: 'Вход для поставщиков', robots: { index: false } };

const BULLETS = [
  ['Деньги сразу вам.', 'Оплата делится в момент платежа: ваша выручка минус комиссия — напрямую на счёт, без реестров.'],
  ['Каталог без ручной работы.', 'Выгрузка из 1С или МоегоСклада (YML/Excel) — карточки, цены и остатки создаются сами.'],
  ['Продажи через подбор.', 'Товары попадают в персональные капсулы медиков — по специальности, размеру и дресс-коду.'],
] as const;

/** Вход поставщика (кадр .Partner-Auth): слева — преимущества площадки, справа — форма. */
export default async function SupplierLoginPage() {
  if ((await serverApi('/supplier/me')).status === 200) redirect('/supplier');
  return (
    <div className={s.page}>
      <RoleSwitch active="supplier" />
      <div className={s.split}>
        <section className={s.promo}>
          <div>
            <div className={s.kicker}>Кабинет поставщика</div>
            <h1>Продавайте медодежду медикам напрямую</h1>
          </div>
          <ul className={s.bullets}>
            {BULLETS.map(([b, text]) => (
              <li key={b}>
                <span className={s.tick}>
                  <img src="/design/icons/sup-tick.svg" alt="" width={14} height={14} />
                </span>
                <span>
                  <b>{b}</b> {text}
                </span>
              </li>
            ))}
          </ul>
          <div className={s.metrics}>
            <div>
              <strong>10%</strong>
              <span>комиссия</span>
            </div>
            <div>
              <strong>СДЭК</strong>
              <span>накладные из кабинета</span>
            </div>
            <div>
              <strong>24 ч</strong>
              <span>модерация</span>
            </div>
          </div>
        </section>
        <section className={s.form}>
          <Link href="/" className={s.logo} aria-label="На главную">
            {BRAND.mark.replace(/\.$/, '')}
            <span className={s.logoDot}>.</span>
          </Link>
          <h2 className={s.title}>Вход для поставщиков</h2>
          <SupplierLoginForm />
        </section>
      </div>
    </div>
  );
}
