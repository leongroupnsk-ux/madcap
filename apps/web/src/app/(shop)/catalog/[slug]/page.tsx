import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/shop/CatalogView';
import { CATALOG_TITLE, categoryChips, fetchCatalog, SITE_URL, type CategoryTree } from '@/lib/catalog';
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

/** Раздел каталога — кадр .Catalog-rope: тот же заголовок, раздел — в надзаголовке и выбранном чипе. */
export default async function CategoryPage({ params, searchParams }: { params: P; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const [res, tree] = await Promise.all([fetchCatalog({ ...sp, category: slug }), serverApi<CategoryTree>('/catalog/categories')]);
  if (!res.data?.category) notFound();
  const cat = res.data.category;
  return (
    <CatalogView
      data={res.data}
      basePath={`/catalog/${slug}`}
      params={sp}
      title={CATALOG_TITLE}
      crumbs={[{ href: '/catalog', label: 'Каталог' }, ...(cat.parent ? [{ href: `/catalog/${cat.parent.slug}`, label: cat.parent.name }] : []), { href: `/catalog/${cat.slug}`, label: cat.name }]}
      chips={categoryChips(tree.data ?? [], { slug: cat.slug, parentSlug: cat.parent?.slug })}
    />
  );
}
