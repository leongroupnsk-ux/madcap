import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContentEditor, type ContentItem } from '@/app/supplier/(cabinet)/content/ContentEditor';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Подборка редакции' };

const SPACE = { api: '/admin/editorial', page: '/admin/editorial', editorial: true };

export default async function EditorialEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === 'new') return <ContentEditor kind="collection" space={SPACE} />;
  const item = (await serverApi<ContentItem>(`/admin/editorial/collections/${id}`)).data;
  if (!item) notFound();
  return <ContentEditor kind="collection" initial={item} space={SPACE} />;
}
