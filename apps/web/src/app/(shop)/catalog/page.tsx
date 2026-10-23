import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/shop/CatalogView';
import { CATALOG_TITLE, categoryChips, fetchCatalog, SITE_URL, type CategoryTree } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const filtered = Object.keys(sp).some((k) => k !== 'page');
  return {
    title: 'Каталог медицинской одежды',
    description: 'Скраб-костюмы, халаты, топы, брюки, медицинская обувь и шапочки от проверенных поставщиков.',
    alternates: { canonical: `${SITE_URL}/catalog` },
    // Комбинации фильтров не индексируем — только сам каталог и категории (ТЗ §11).
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

/** Каталог — кадр .Catalog макета. */
export default async function CatalogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [res, tree] = await Promise.all([fetchCatalog(sp), serverApi<CategoryTree>('/catalog/categories')]);
  if (!res.data) notFound();
  return (
    <CatalogView
      data={res.data}
      basePath="/catalog"
      params={sp}
      title={CATALOG_TITLE}
      crumbs={[{ href: '/catalog', label: 'Каталог' }]}
      chips={categoryChips(tree.data ?? [])}
    />
  );
}
