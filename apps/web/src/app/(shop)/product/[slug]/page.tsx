import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Gallery } from '@/components/shop/Gallery';
import { ProductBuy } from '@/components/shop/ProductBuy';
import p from '@/components/shop/product.module.css';
import { BRAND } from '@/lib/brand';
import { SITE_URL, type ProductDetails } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

type P = Promise<{ slug: string }>;
const GENDER: Record<string, string> = { female: 'Женский', male: 'Мужской', unisex: 'Унисекс' };

async function load(slug: string) {
  return (await serverApi<ProductDetails>(`/catalog/products/${encodeURIComponent(slug)}`)).data;
}

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const product = await load((await params).slug);
  if (!product) return { title: 'Товар не найден' };
  const min = Math.min(...product.variants.filter((v) => v.stock > 0).map((v) => v.price)) / 100;
  const image = product.media.find((m) => m.type === 'photo')?.url;
  return {
    title: `${product.title} — ${product.brand.name}`,
    description: `${product.title} от ${product.brand.name}: от ${min.toLocaleString('ru-RU')} ₽, ${product.fabric ?? 'медицинская ткань'}. Доставка СДЭК.`,
    alternates: { canonical: `${SITE_URL}/product/${product.slug}` },
    openGraph: { title: product.title, images: image ? [`${SITE_URL}${image}`] : undefined, type: 'website' },
  };
}

export default async function ProductPage({ params }: { params: P }) {
  const product = await load((await params).slug);
  if (!product) notFound();
  const cat = product.category;
  const inStock = product.variants.filter((v) => v.stock > 0);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: product.title,
        brand: { '@type': 'Brand', name: product.brand.name },
        sku: product.externalId ?? product.variants[0]?.sku,
        description: product.description ?? undefined,
        image: product.media.filter((m) => m.type === 'photo').map((m) => `${SITE_URL}${m.url}`),
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'RUB',
          lowPrice: Math.min(...inStock.map((v) => v.price)) / 100,
          highPrice: Math.max(...inStock.map((v) => v.price)) / 100,
          offerCount: inStock.length,
          availability: 'https://schema.org/InStock',
          seller: { '@type': 'Organization', name: product.seller.name },
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { name: 'Каталог', item: `${SITE_URL}/catalog` },
          ...(cat.parent ? [{ name: cat.parent.name, item: `${SITE_URL}/catalog/${cat.parent.slug}` }] : []),
          { name: cat.name, item: `${SITE_URL}/catalog/${cat.slug}` },
          { name: product.title, item: `${SITE_URL}/product/${product.slug}` },
        ].map((x, i) => ({ '@type': 'ListItem', position: i + 1, ...x })),
      },
    ],
  };

  return (
    <div className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Link href={`/catalog/${cat.slug}`} className={p.back}>
        ← К каталогу
      </Link>
      <nav className={p.crumbs} aria-label="Хлебные крошки">
        <Link href="/catalog">Каталог</Link>
        {cat.parent && (
          <>
            {' — '}
            <Link href={`/catalog/${cat.parent.slug}`}>{cat.parent.name}</Link>
          </>
        )}
        {' — '}
        <Link href={`/catalog/${cat.slug}`}>{cat.name}</Link>
        {' — '}
        {product.title}
      </nav>

      <div className={p.layout}>
        <Gallery media={product.media} title={product.title} initialColorId={product.variants.find((v) => v.stock > 0)?.color.id ?? null} />
        <ProductBuy product={product} />
      </div>

      <div className={p.sections}>
        <section>
          <h2>О товаре</h2>
          <p className={p.text}>{product.description}</p>
        </section>
        <section>
          <h2>Характеристики</h2>
          <table className={p.specs}>
            <tbody>
              {product.fabric && (
                <tr>
                  <td>Состав</td>
                  <td>{product.fabric}</td>
                </tr>
              )}
              {product.treatment && (
                <tr>
                  <td>Обработка</td>
                  <td>{product.treatment}</td>
                </tr>
              )}
              {product.washing && (
                <tr>
                  <td>Уход</td>
                  <td>{product.washing}</td>
                </tr>
              )}
              <tr>
                <td>Пол</td>
                <td>{GENDER[product.gender]}</td>
              </tr>
              {product.specialties.length > 0 && (
                <tr>
                  <td>Специальности</td>
                  <td>{product.specialties.join(', ')}</td>
                </tr>
              )}
              <tr>
                <td>Продавец</td>
                <td>
                  {product.seller.name}, ИНН {product.seller.inn}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        {product.articles.length > 0 && (
          <section>
            <h2>Полезно о выборе формы</h2>
            <div className={p.related}>
              {product.articles.map((a) => (
                <Link key={a.slug} href={`/journal/${a.slug}`} className={p.relCard}>
                  {a.coverUrl ? <img src={a.coverUrl} alt="" /> : <span className={p.noimg} />}
                  <span>
                    <b>{a.title}</b>
                    {a.lead && <small>{a.lead}</small>}
                    <small style={{ color: 'var(--c-sale)' }}>Читать статью →</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
        {product.collections.length > 0 && (
          <section>
            <h2>В подборках</h2>
            <div className={p.related}>
              {product.collections.map((c) => (
                <Link key={c.slug} href={`/collections/${c.slug}`} className={p.relCard}>
                  {c.coverUrl ? <img src={c.coverUrl} alt="" /> : <span className={p.noimg} />}
                  <span>
                    <b>{c.title}</b>
                    <small>
                      {c.count} товаров · {BRAND.name} →
                    </small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
