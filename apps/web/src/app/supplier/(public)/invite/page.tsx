import type { Metadata } from 'next';
import s from '@/components/supplier/public.module.css';
import { BRAND } from '@/lib/brand';
import { InviteForm } from './InviteForm';

export const metadata: Metadata = { title: 'Доступ в кабинет поставщика', robots: { index: false } };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logo}>{BRAND.mark}</div>
        <h1 className={s.title}>Задайте пароль</h1>
        <p className={s.note}>Пароль нужен для входа в кабинет поставщика.</p>
        <InviteForm token={token ?? ''} />
      </div>
    </div>
  );
}
