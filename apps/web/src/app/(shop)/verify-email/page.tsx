import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth/AuthCard';
import { VerifyEmail } from './VerifyEmail';

export const metadata: Metadata = { title: 'Подтверждение email', robots: { index: false } };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Подтверждение email">
      <VerifyEmail token={token ?? ''} />
    </AuthCard>
  );
}
