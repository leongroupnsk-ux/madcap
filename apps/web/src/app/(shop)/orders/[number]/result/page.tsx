import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { Result } from './Result';

export const metadata: Metadata = { title: 'Оплата заказа', robots: { index: false } };

export default async function ResultPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!(await getSessionUser())) redirect(`/login?next=/orders/${number}/result`);
  return <Result number={number} />;
}
