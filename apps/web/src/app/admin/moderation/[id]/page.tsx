import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { Review, type Details } from './Review';

export const metadata = { title: 'Проверка товара' };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverApi<Details>(`/admin/moderation/products/${id}`);
  if (!res.data) notFound();
  return <Review d={res.data} />;
}
