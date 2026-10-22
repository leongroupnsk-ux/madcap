import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/shop/CatalogView';
import { fetchCatalog } from '@/lib/catalog';

type SP = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Поиск', robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const res = await fetchCatalog(sp);
  if (!res.data) notFound();
  return (
    <CatalogView
      data={res.data}
      basePath="/search"
      params={sp}
      title={q ? `Поиск: «${q}» · ${res.data.total}` : 'Поиск'}
      crumbs={[{ href: '/catalog', label: 'Каталог' }]}
      chips={[]}
    />
  );
}
