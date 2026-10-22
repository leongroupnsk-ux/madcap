import type { Metadata } from 'next';
import Link from 'next/link';
import j from '@/components/shop/journal.module.css';
import { SITE_URL, type JournalItem } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = {
  title: 'Журнал',
  description: 'Как выбрать медицинскую форму, ухаживать за ней и собрать капсулу под специальность.',
  alternates: { canonical: `${SITE_URL}/journal` },
};
export const revalidate = 300;

const date = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function JournalPage() {
  const items = (await serverApi<JournalItem[]>('/journal')).data ?? [];
  return (
    <section className="container" style={{ paddingTop: 40 }}>
      <div className="eyebrow">Полезное</div>
      <h1 style={{ fontSize: 'clamp(40px, 5vw, 56px)', marginTop: 10 }}>Журнал</h1>
      {!items.length && <p style={{ color: 'var(--c-text-muted)' }}>Материалы скоро появятся.</p>}
      <div className={j.grid}>
        {items.map((it) => (
          <Link key={`${it.kind}-${it.slug}`} href={it.kind === 'article' ? `/journal/${it.slug}` : `/collections/${it.slug}`} className={`${j.card} ${it.kind === 'collection' ? j.cardCollection : ''}`}>
            {it.coverUrl ? <img src={it.coverUrl} alt="" className={j.cover} /> : <span className={j.cover} />}
            <div className={j.cardBody}>
              <span className={j.by}>
                {it.author} · {it.kind === 'collection' ? `${it.count} товаров` : date(it.publishedAt)}
              </span>
              <h2>{it.title}</h2>
              {it.lead && <p>{it.lead}</p>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
