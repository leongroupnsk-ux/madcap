import { plural } from '@aesculap/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import j from '@/components/shop/journal.module.css';
import { SITE_URL, pubDate, type JournalItem } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = {
  title: 'Журнал',
  description: 'Как выбрать медицинскую форму, ухаживать за ней и собрать капсулу под специальность.',
  alternates: { canonical: `${SITE_URL}/journal` },
};
export const revalidate = 300;

/** Лента журнала — кадр .Articles: статьи и подборки (подборки — на мятном фоне). */
export default async function JournalPage() {
  const items = (await serverApi<JournalItem[]>('/journal')).data ?? [];
  return (
    <section className={j.page}>
      <div className="eyebrow">Полезное</div>
      <h1>Журнал</h1>
      {!items.length && <p className={j.empty}>Материалы скоро появятся.</p>}
      {items.length > 0 && (
        <div className={j.grid}>
          {items.map((it) => {
            const collection = it.kind === 'collection';
            return (
              <Link key={`${it.kind}-${it.slug}`} href={collection ? `/collections/${it.slug}` : `/journal/${it.slug}`} className={`${j.card} ${collection ? j.cardCollection : ''}`}>
                {it.coverUrl ? <img src={it.coverUrl} alt="" className={j.cover} loading="lazy" /> : <span className={j.cover} />}
                <div className={j.cardBody}>
                  <span className={j.by}>
                    <span className={j.upper}>{it.author}</span> ·{' '}
                    {collection ? <span className={j.upper}>{`${it.count} ${plural(it.count, 'товар', 'товара', 'товаров')}`}</span> : pubDate(it.publishedAt)}
                  </span>
                  <h2>{it.title}</h2>
                  {/* у подборки в макете только заголовок */}
                  {!collection && it.lead && <p>{it.lead}</p>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
