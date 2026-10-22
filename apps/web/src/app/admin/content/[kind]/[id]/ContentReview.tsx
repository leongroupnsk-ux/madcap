'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import j from '@/components/shop/journal.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

export type Preview = {
  kind: 'article' | 'collection'; id: string; title: string; status: string; supplier: string; coverUrl: string | null;
  lead: string | null; body: string | null; description: string | null; products: { id: string; title: string; moderationStatus: string }[];
};

export function ContentReview({ d }: { d: Preview }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    try {
      if (approve) await api(`/admin/content/${d.kind}/${d.id}/approve`, {});
      else {
        const reason = prompt('Причина отказа — её увидит автор');
        if (!reason) return;
        await api(`/admin/content/${d.kind}/${d.id}/reject`, { reason });
      }
      router.replace('/admin/content');
      router.refresh();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Ошибка');
    }
  };
  return (
    <>
      <Link href="/admin/content" className={s.link}>
        ← К очереди
      </Link>
      <div className={s.head} style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">
            {d.supplier} · {d.kind === 'article' ? 'статья' : 'подборка'}
          </div>
          <h1>{d.title}</h1>
        </div>
        {d.status === 'pending' && (
          <div className={s.actions}>
            <Button variant="outline" onClick={() => decide(false)}>
              Отклонить
            </Button>
            <Button onClick={() => decide(true)}>Опубликовать</Button>
          </div>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <section className={s.panel}>
        <div className={j.article}>
          {d.coverUrl && <img src={d.coverUrl} alt="" className={j.articleCover} style={{ marginTop: 0 }} />}
          {(d.lead || d.description) && <p className={j.lead}>{d.lead ?? d.description}</p>}
          {d.body && <div className={j.body} dangerouslySetInnerHTML={{ __html: d.body }} />}
        </div>
      </section>
      <section className={s.panel} style={{ marginTop: 16 }}>
        <h2>Товары · {d.products.length}</h2>
        <ul>
          {d.products.map((p) => (
            <li key={p.id}>
              {p.title} <span className={s.muted}>({p.moderationStatus})</span>
            </li>
          ))}
        </ul>
        <p className={s.muted}>На витрине покажутся только опубликованные товары в наличии.</p>
      </section>
    </>
  );
}
