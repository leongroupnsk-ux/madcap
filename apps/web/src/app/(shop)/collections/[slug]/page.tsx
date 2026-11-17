import { plural } from '@aesculap/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import j from '@/components/shop/journal.module.css';
import { ProductGrid } from '@/components/shop/ProductCard';
import { SITE_URL, type Card } from '@/lib/catalog';
import { ARTICLE_COVER_SIZES, imgSet, type ImageSet } from '@/lib/image';
import { pageMissing, serverApi } from '@/lib/server-api';

type Collection = { slug: string; title: string; description: string | null; author: string; coverUrl: string | null; cover?: ImageSet | null; products: Card[] };
type P = Promise<{ slug: string }>;
const load = (slug: string) => serverApi<Collection>(`/journal/collections/${encodeURIComponent(slug)}`);

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const c = (await load((await params).slug)).data;
  if (!c) return { title: 'Подборка не найдена' };
  return { title: c.title, description: c.description ?? undefined, alternates: { canonical: `${SITE_URL}/collections/${c.slug}` } };
}

export default async function CollectionPage({ params }: { params: P }) {
  const { data: c, status } = await load((await params).slug);
  if (!c) pageMissing(status);
  return (
    <section className={j.page}>
      <Link href="/journal" className={j.back}>
        ← Назад
      </Link>
      <div className={j.head}>
        {c.coverUrl && <img {...imgSet(c.cover, ARTICLE_COVER_SIZES, c.coverUrl)} alt="" className={j.articleCover} />}
        <div className={j.by}>
          <span className={j.upper}>
            {c.author} · {c.products.length} {plural(c.products.length, 'товар', 'товара', 'товаров')}
          </span>
        </div>
        <h1>{c.title}</h1>
      </div>
      {c.description && (
        <div className={j.text}>
          <p>{c.description}</p>
        </div>
      )}
      {c.products.length > 0 && (
        <div className={j.collectionGrid}>
          <ProductGrid items={c.products} eager />
        </div>
      )}
    </section>
  );
}
