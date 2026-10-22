import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/catalog';

type SitemapData = {
  products: { slug: string; updatedAt: string }[];
  categories: { slug: string }[];
  articles: { slug: string; updatedAt: string }[];
  collections: { slug: string; updatedAt: string }[];
};

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';
  const data = (await fetch(`${api}/api/catalog/sitemap`, { next: { revalidate: 3600 } })
    .then((r) => r.json())
    .catch(() => null)) as SitemapData | null;
  const fixed = ['', '/catalog', '/journal', '/suppliers'].map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: 'daily' as const }));
  if (!data) return fixed;
  return [
    ...fixed,
    ...data.categories.map((c) => ({ url: `${SITE_URL}/catalog/${c.slug}`, changeFrequency: 'daily' as const })),
    ...data.products.map((p) => ({ url: `${SITE_URL}/product/${p.slug}`, lastModified: p.updatedAt })),
    ...data.articles.map((a) => ({ url: `${SITE_URL}/journal/${a.slug}`, lastModified: a.updatedAt })),
    ...data.collections.map((c) => ({ url: `${SITE_URL}/collections/${c.slug}`, lastModified: c.updatedAt })),
  ];
}
