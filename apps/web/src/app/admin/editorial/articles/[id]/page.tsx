import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContentEditor, type ContentItem } from '@/app/supplier/(cabinet)/content/ContentEditor';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Статья редакции' };

const SPACE = { api: '/admin/editorial', page: '/admin/editorial', editorial: true };

export default async function EditorialEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === 'new') return <ContentEditor kind="article" space={SPACE} />;
  const item = (await serverApi<ContentItem>(`/admin/editorial/articles/${id}`)).data;
  if (!item) notFound();
  return <ContentEditor kind="article" initial={item} space={SPACE} />;
}
