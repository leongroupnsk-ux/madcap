import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/supplier/public.module.css';
import { BRAND } from '@/lib/brand';
import { ApplyForm } from './ApplyForm';

export const metadata: Metadata = { title: 'Заявка на подключение поставщика' };

/** Заявка на подключение (кадр .Partner-Auth-Request). */
export default function ApplyPage() {
  return (
    <div className={s.page}>
      <div className={s.card}>
        <Link href="/" className={s.logo} aria-label="На главную">
          {BRAND.mark.replace(/\.$/, '')}
          <span className={s.logoDot}>.</span>
        </Link>
        <h1 className={`${s.title} ${s.titleSm}`}>Заявка на подключение</h1>
        <ApplyForm />
      </div>
    </div>
  );
}
