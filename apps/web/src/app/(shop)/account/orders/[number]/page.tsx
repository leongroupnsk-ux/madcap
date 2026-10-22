import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import { OrderView, type OrderData } from './OrderView';

export const metadata: Metadata = { title: 'Заказ', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!(await getSessionUser())) redirect(`/login?next=/account/orders/${number}`);
  const order = await serverApi<OrderData>(`/orders/${encodeURIComponent(number)}`);
  if (!order.data) notFound();
  return <OrderView initial={order.data} />;
}
