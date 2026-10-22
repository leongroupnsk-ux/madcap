import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import { ContentEditor, type ContentItem } from '../../ContentEditor';

export const metadata: Metadata = { title: 'Статья' };

export default async function ArticleEditPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSupplier())) return null;
  const { id } = await params;
  if (id === 'new') return <ContentEditor kind="article" />;
  const item = (await serverApi<ContentItem>(`/supplier/content/articles/${id}`)).data;
  if (!item) notFound();
  return <ContentEditor kind="article" initial={item} />;
}
