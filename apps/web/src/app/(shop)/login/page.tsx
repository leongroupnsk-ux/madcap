import type { Metadata } from 'next';
import { safeNext } from '@/lib/safe-next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { getSessionUser } from '@/lib/session';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Вход', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Только внутренние пути — защита от открытого редиректа.
  const target = safeNext(next) ?? '/account';
  if (await getSessionUser()) redirect(target);
  return (
    <AuthCard title="С возвращением.">
      <LoginForm next={target} />
    </AuthCard>
  );
}
