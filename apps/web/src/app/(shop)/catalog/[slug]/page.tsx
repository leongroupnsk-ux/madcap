import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/shop/CatalogView';
import { fetchCatalog, SITE_URL } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

type SP = Promise<Record<string, string | string[] | undefined>>;
type P = Promise<{ slug: string }>;

export async function generateMetadata({ params, searchParams }: { params: P; searchParams: SP }): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const res = await fetchCatalog({ category: slug, perPage: '1' });
  if (!res.data?.category) return { title: 'Каталог' };
  const name = res.data.category.name;
  return {
    title: `${name} — медицинская одежда`,
    description: `${name} для медработников: ${res.data.total} моделей в наличии, доставка СДЭК 2–4 дня.`,
    alternates: { canonical: `${SITE_URL}/catalog/${slug}` },
    robots: Object.keys(sp).some((k) => k !== 'page') ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: { params: P; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const res = await fetchCatalog({ ...sp, category: slug });
  if (!res.data?.category) notFound();
  const cat = res.data.category;
  const parent = cat.parent ?? { name: cat.name, slug: cat.slug };
  // Чипы: подкатегории родителя; у категории без подкатегорий — соседние разделы каталога.
  const siblings = cat.parent ? ((await fetchCatalog({ category: cat.parent.slug, perPage: '1' })).data?.category?.children ?? []) : cat.children;
  const topLevel = !cat.parent && !siblings.length ? ((await serverApi<{ name: string; slug: string }[]>('/catalog/categories')).data ?? []) : null;
  const chips = topLevel
    ? [{ href: '/catalog', label: 'Все', active: false }, ...topLevel.map((c) => ({ href: `/catalog/${c.slug}`, label: c.name, active: c.slug === slug }))]
    : [{ href: `/catalog/${parent.slug}`, label: 'Все', active: !cat.parent }, ...siblings.map((c) => ({ href: `/catalog/${c.slug}`, label: c.name, active: c.slug === slug }))];
  return (
    <CatalogView
      data={res.data}
      basePath={`/catalog/${slug}`}
      params={sp}
      title={cat.name}
      crumbs={[{ href: '/catalog', label: 'Каталог' }, ...(cat.parent ? [{ href: `/catalog/${cat.parent.slug}`, label: cat.parent.name }] : []), { href: `/catalog/${cat.slug}`, label: cat.name }]}
      chips={chips}
    />
  );
}
