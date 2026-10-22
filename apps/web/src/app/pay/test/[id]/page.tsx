import type { Metadata } from 'next';
import { TestPay } from './TestPay';

export const metadata: Metadata = { title: 'Тестовая оплата', robots: { index: false } };

export default async function TestPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TestPay id={id} />;
}
