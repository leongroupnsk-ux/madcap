import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import j from '@/components/shop/journal.module.css';
import { ProductGrid } from '@/components/shop/ProductCard';
import { SITE_URL, type Card } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

type Article = { slug: string; title: string; lead: string | null; body: string; author: string; publishedAt: string; updatedAt: string; coverUrl: string | null; products: Card[] };
type P = Promise<{ slug: string }>;

const load = async (slug: string) => (await serverApi<Article>(`/journal/articles/${encodeURIComponent(slug)}`)).data;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const a = await load((await params).slug);
  if (!a) return { title: 'Статья не найдена' };
  return {
    title: a.title,
    description: a.lead ?? undefined,
    alternates: { canonical: `${SITE_URL}/journal/${a.slug}` },
    openGraph: { type: 'article', title: a.title, images: a.coverUrl ? [`${SITE_URL}${a.coverUrl}`] : undefined },
  };
}

export default async function ArticlePage({ params }: { params: P }) {
  const a = await load((await params).slug);
  if (!a) notFound();
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.lead ?? undefined,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt,
    author: { '@type': 'Organization', name: a.author },
    image: a.coverUrl ? [`${SITE_URL}${a.coverUrl}`] : undefined,
  };
  return (
    <article className="container" style={{ paddingTop: 28 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <Link href="/journal" style={{ color: 'var(--c-sale)', textDecoration: 'none', fontSize: 14 }}>
        ← Назад
      </Link>
      <div className={j.article}>
        {a.coverUrl && <img src={a.coverUrl} alt="" className={j.articleCover} />}
        <div className={j.by}>
          {a.author} · {new Date(a.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <h1>{a.title}</h1>
        {a.lead && <p className={j.lead}>{a.lead}</p>}
        {/* HTML очищен на сервере по белому списку тегов (ContentService.cleanHtml) */}
        <div className={j.body} dangerouslySetInnerHTML={{ __html: a.body }} />
      </div>
      {a.products.length > 0 && (
        <div className={j.products}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Товары из статьи
          </div>
          <ProductGrid items={a.products} />
        </div>
      )}
    </article>
  );
}
