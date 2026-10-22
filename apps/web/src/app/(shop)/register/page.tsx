import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { getSessionUser } from '@/lib/session';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = { title: 'Создать аккаунт', robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = next?.startsWith('/') && !next.startsWith('//') ? next : null;
  if (await getSessionUser()) redirect(target ?? '/account');
  return (
    <AuthCard title="Создать аккаунт">
      <RegisterForm next={target} />
    </AuthCard>
  );
}
