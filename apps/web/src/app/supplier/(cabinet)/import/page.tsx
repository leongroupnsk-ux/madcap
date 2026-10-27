import type { Metadata } from 'next';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import type { ImportJob } from '@/lib/types';
import { ImportScreen, type FeedState } from './ImportScreen';

export const metadata: Metadata = { title: 'Импорт товаров' };

export default async function ImportPage() {
  const me = await requireSupplier();
  if (!me) return null;
  const [jobs, feed] = await Promise.all([serverApi<ImportJob[]>('/supplier/import'), serverApi<FeedState>('/supplier/import/feed')]);
  return <ImportScreen feedUrl={me.supplier.ymlFeedUrl} initialJobs={jobs.data ?? []} initialFeed={feed.data} owner={me.role === 'owner'} />;
}
