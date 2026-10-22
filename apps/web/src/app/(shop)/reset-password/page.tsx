import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth/AuthCard';
import { ForgotForm, NewPasswordForm } from './ResetForms';

export const metadata: Metadata = { title: 'Восстановление пароля', robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return token ? (
    <AuthCard title="Новый пароль">
      <NewPasswordForm token={token} />
    </AuthCard>
  ) : (
    <AuthCard title="Восстановление пароля">
      <ForgotForm />
    </AuthCard>
  );
}
