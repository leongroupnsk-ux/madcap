import type { Metadata } from 'next';
import s from '@/components/supplier/public.module.css';
import { BRAND } from '@/lib/brand';
import { ApplyForm } from './ApplyForm';

export const metadata: Metadata = { title: 'Заявка на подключение поставщика' };

export default function ApplyPage() {
  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logo}>{BRAND.mark}</div>
        <h1 className={s.title}>Заявка на подключение</h1>
        <ApplyForm />
      </div>
    </div>
  );
}
