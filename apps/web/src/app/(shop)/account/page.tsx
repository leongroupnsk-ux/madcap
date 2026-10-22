import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { AccountActions } from './AccountActions';

export const metadata: Metadata = { title: 'Мой профиль', robots: { index: false } };

// Полный профиль (анкета, фото, заказы) — E3-07; сейчас аккаунт и выход.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/account');
  const { welcome } = await searchParams;
  return (
    <section className="container" style={{ padding: '48px var(--gutter)' }}>
      <div className="eyebrow">Мой профиль</div>
      <h1 style={{ fontSize: 44, margin: '12px 0 24px' }}>Добрый день.</h1>
      <AccountActions email={user.email} emailVerified={user.emailVerified} welcome={welcome === '1'} />
    </section>
  );
}
