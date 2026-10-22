import 'server-only';
import { serverApi } from './server-api';

export type Card = {
  id: string; slug: string; title: string; brand: string; images: (string | null)[]; price: number; oldPrice: number | null;
  sale: boolean; color: string; sizes: string; heightRange: string | null; fits?: boolean;
};

export type Facets = {
  genders: { value: 'female' | 'male' | 'unisex'; count: number }[];
  sizes: { value: string; count: number }[];
  heights: { value: string; count: number }[];
  colors: { id: string; name: string; hex: string; count: number }[];
  brands: { slug: string; name: string; count: number }[];
  specialties: { id: string; name: string; count: number }[];
  price: { min: number; max: number };
};

export type CatalogList = {
  category: { name: string; slug: string; parent: { name: string; slug: string } | null; children: { name: string; slug: string }[] } | null;
  total: number; page: number; pages: number; perPage: number; items: Card[]; facets: Facets;
};

export type ProductDetails = {
  fits?: boolean;
  recommended?: { size: string | null; heightRange: string | null } | null;
  id: string; slug: string; title: string; brand: { name: string; slug: string };
  sizeChart: { clothes: { columns: string[]; rows: string[][] }; shoes: { columns: string[]; rows: string[][] } };
  category: { name: string; slug: string; parent: { name: string; slug: string } | null };
  gender: string; fabric: string | null; treatment: string | null; washing: string | null; description: string | null; externalId: string | null;
  specialties: string[];
  seller: { name: string; inn: string; city: string | null; shipDays: number };
  media: { id: string; type: 'photo' | 'video'; url: string; thumbUrl: string | null; posterUrl: string | null }[];
  variants: { id: string; sku: string; size: string; heightRange: string | null; color: { id: string; name: string; hex: string }; price: number; oldPrice: number | null; stock: number }[];
  articles: { slug: string; title: string; lead: string | null; coverUrl: string | null }[];
  collections: { slug: string; title: string; coverUrl: string | null; count: number }[];
};

export type JournalItem = { kind: 'article' | 'collection'; slug: string; title: string; lead: string | null; author: string; publishedAt: string; coverUrl: string | null; count: number };

export function toQuery(params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => q.append(k, x));
  }
  return q;
}

export async function fetchCatalog(params: Record<string, string | string[] | undefined>) {
  return serverApi<CatalogList>(`/catalog/products?${toQuery(params)}`);
}

/** Абсолютный адрес сайта для canonical, sitemap и разметки. */
export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:4000';
