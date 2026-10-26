import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/supplier/public.module.css';
import { BRAND } from '@/lib/brand';
import { InviteForm } from './InviteForm';

export const metadata: Metadata = { title: 'Доступ в кабинет поставщика', robots: { index: false } };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className={s.page}>
      <div className={s.card}>
        <Link href="/" className={s.logo} aria-label="aesculap — на главную">
          {BRAND.mark.replace(/\.$/, '')}
          <span className={s.logoDot}>.</span>
        </Link>
        <h1 className={`${s.title} ${s.titleSm}`}>Задайте пароль</h1>
        <p className={s.lead}>Пароль нужен для входа в кабинет поставщика.</p>
        <InviteForm token={token ?? ''} />
      </div>
    </div>
  );
}
