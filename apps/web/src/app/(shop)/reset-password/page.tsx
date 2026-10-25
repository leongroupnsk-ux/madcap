import type { Metadata } from 'next';
import { ForgotFlow, NewPasswordForm } from './ResetForms';

export const metadata: Metadata = { title: 'Восстановление пароля', robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return token ? <NewPasswordForm token={token} /> : <ForgotFlow />;
}
