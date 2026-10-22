import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import { ContentEditor, type ContentItem } from '../../ContentEditor';

export const metadata: Metadata = { title: 'Подборка' };

export default async function CollectionEditPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSupplier())) return null;
  const { id } = await params;
  if (id === 'new') return <ContentEditor kind="collection" />;
  const item = (await serverApi<ContentItem>(`/supplier/content/collections/${id}`)).data;
  if (!item) notFound();
  return <ContentEditor kind="collection" initial={item} />;
}
