import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { getSessionUser } from '@/lib/session';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = { title: 'Создать аккаунт', robots: { index: false } };

export default async function RegisterPage() {
  if (await getSessionUser()) redirect('/account');
  return (
    <AuthCard title="Создать аккаунт">
      <RegisterForm />
    </AuthCard>
  );
}
