import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/shop/CatalogView';
import { fetchCatalog, SITE_URL } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

type SP = Promise<Record<string, string | string[] | undefined>>;
type Tree = { name: string; slug: string; children: { name: string; slug: string }[] }[];

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

export default async function CatalogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [res, tree] = await Promise.all([fetchCatalog(sp), serverApi<Tree>('/catalog/categories')]);
  if (!res.data) notFound();
  return (
    <CatalogView
      data={res.data}
      basePath="/catalog"
      params={sp}
      title="Медицинская одежда без случайных вещей."
      crumbs={[{ href: '/catalog', label: 'Каталог' }]}
      chips={[{ href: '/catalog', label: 'Все', active: true }, ...(tree.data ?? []).map((c) => ({ href: `/catalog/${c.slug}`, label: c.name, active: false }))]}
    />
  );
}
