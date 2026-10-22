import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { ContentReview, type Preview } from './ContentReview';

export const metadata = { title: 'Проверка материала' };

export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const data = (await serverApi<Preview>(`/admin/content/${kind}/${id}`)).data;
  if (!data) notFound();
  return <ContentReview d={data} />;
}
