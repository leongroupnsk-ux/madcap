import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import s from '@/components/supplier/public.module.css';
import { BRAND } from '@/lib/brand';
import { serverApi } from '@/lib/server-api';
import { SupplierLoginForm } from './SupplierLoginForm';

export const metadata: Metadata = { title: 'Вход для поставщиков', robots: { index: false } };

export default async function SupplierLoginPage() {
  if ((await serverApi('/supplier/me')).status === 200) redirect('/supplier');
  return (
    <div className={s.page}>
      <div className={s.split}>
        <section className={s.promo}>
          <div>
            <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>
              Кабинет поставщика
            </div>
            <h1 style={{ marginTop: 12 }}>Продавайте медодежду медикам напрямую</h1>
          </div>
          <ul className={s.bullets}>
            <li>
              <span className={s.tick}>✓</span>
              <span>
                <b>Деньги сразу вам.</b> Оплата делится в момент платежа: ваша выручка минус комиссия — напрямую на счёт, без реестров.
              </span>
            </li>
            <li>
              <span className={s.tick}>✓</span>
              <span>
                <b>Каталог без ручной работы.</b> Выгрузка из 1С или МоегоСклада (YML/Excel) — карточки, цены и остатки создаются сами.
              </span>
            </li>
            <li>
              <span className={s.tick}>✓</span>
              <span>
                <b>Продажи через подбор.</b> Товары попадают в персональные капсулы медиков — по специальности, размеру и дресс-коду.
              </span>
            </li>
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
          <div className={s.logo}>{BRAND.mark}</div>
          <h2 className={s.title}>Вход для поставщиков</h2>
          <SupplierLoginForm />
        </section>
      </div>
    </div>
  );
}
