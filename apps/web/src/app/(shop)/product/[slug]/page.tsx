import { plural } from '@aesculap/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
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

  // Характеристики — список «название — значение», как в макете
  const specs: [string, string][] = [
    ...(product.fabric ? [['Состав', product.fabric] as [string, string]] : []),
    ...(product.treatment ? [['Обработка', product.treatment] as [string, string]] : []),
    ...(product.washing ? [['Уход', `Стирка ${product.washing}`] as [string, string]] : []),
    ['Пол', GENDER[product.gender]],
    ...(product.specialties.length ? [['Специальности', product.specialties.join(', ')] as [string, string]] : []),
    ['Продавец', `${product.seller.name}, ИНН ${product.seller.inn}`],
  ];
  const crumbs = [{ href: '/catalog', name: 'Каталог' }, ...(cat.parent ? [{ href: `/catalog/${cat.parent.slug}`, name: cat.parent.name }] : []), { href: `/catalog/${cat.slug}`, name: cat.name }];

  return (
    <div className={`container ${p.page}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Link href={`/catalog/${cat.slug}`} className={p.back}>
        ← К каталогу
      </Link>
      <nav className={p.crumbs} aria-label="Хлебные крошки">
        {crumbs.map((c) => (
          <Fragment key={c.href}>
            <Link href={c.href}>{c.name}</Link>
            <span aria-hidden>→</span>
          </Fragment>
        ))}
        <span aria-current="page">{product.title}</span>
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
          <dl className={p.specs}>
            {specs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {(product.articles.length > 0 || product.collections.length > 0) && (
        <div className={`${p.sections} ${p.relatedSections}`}>
          {product.articles.length > 0 && (
            <section>
              <h2>Полезно о выборе формы</h2>
              <div className={p.related}>
                {product.articles.map((a) => (
                  <Link key={a.slug} href={`/journal/${a.slug}`} className={`${p.relCard} ${p.relArticle}`}>
                    {a.coverUrl ? <img src={a.coverUrl} alt="" /> : <span className={p.noimg} />}
                    <span>
                      <b>{a.title}</b>
                      {a.lead && <small>{a.lead}</small>}
                      <em>Читать статью →</em>
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
                        {c.count} {plural(c.count, 'товар', 'товара', 'товаров')} · {BRAND.name} <i>→</i>
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
