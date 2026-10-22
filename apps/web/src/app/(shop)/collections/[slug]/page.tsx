import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import j from '@/components/shop/journal.module.css';
import { ProductGrid } from '@/components/shop/ProductCard';
import { SITE_URL, type Card } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

type Collection = { slug: string; title: string; description: string | null; author: string; coverUrl: string | null; products: Card[] };
type P = Promise<{ slug: string }>;
const load = async (slug: string) => (await serverApi<Collection>(`/journal/collections/${encodeURIComponent(slug)}`)).data;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return { title: 'Подборка не найдена' };
  return { title: c.title, description: c.description ?? undefined, alternates: { canonical: `${SITE_URL}/collections/${c.slug}` } };
}

export default async function CollectionPage({ params }: { params: P }) {
  const c = await load((await params).slug);
  if (!c) notFound();
  return (
    <section className="container" style={{ paddingTop: 28 }}>
      <Link href="/journal" style={{ color: 'var(--c-sale)', textDecoration: 'none', fontSize: 14 }}>
        ← Назад
      </Link>
      <div className={j.article}>
        {c.coverUrl && <img src={c.coverUrl} alt="" className={j.articleCover} />}
        <div className={j.by}>
          {c.author} · {c.products.length} товаров
        </div>
        <h1>{c.title}</h1>
        {c.description && <p className={j.lead}>{c.description}</p>}
      </div>
      <div style={{ marginTop: 24 }}>
        <ProductGrid items={c.products} />
      </div>
    </section>
  );
}
