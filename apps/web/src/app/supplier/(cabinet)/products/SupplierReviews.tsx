'use client';

import { REVIEW_FIT_LABEL, plural } from '@aesculap/shared';
import { useEffect, useId, useState } from 'react';
import { Stars } from '@/components/shop/Stars';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Item = { id: string; author: string; rating: number; fit: 'small' | 'true_to_size' | 'large'; text: string; publishedAt: string; photos: { url: string | null }[]; reply: string | null; replyAt: string | null };
type Data = { count: number; avg: number | null; items: Item[] };

const day = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Отзывы покупателей на товар в кабинете (только чтение): одобренные модератором отзывы
 * и один ответ продавца на отзыв — публикуется на витрине сразу.
 */
export function SupplierReviews({ productId }: { productId: string }) {
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Data>(`/supplier/products/${productId}/reviews`)
      .then(setData)
      .catch(() => undefined);
  }, [productId]);

  if (!data) return null;
  return (
    <section className={s.panel} style={{ marginTop: 16 }} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>
        Отзывы покупателей
        {data.count > 0 && (
          <span className={s.muted} style={{ marginLeft: 12, fontWeight: 400 }}>
            {data.avg?.toLocaleString('ru-RU', { minimumFractionDigits: 1 })} из 5 · {data.count} {plural(data.count, 'отзыв', 'отзыва', 'отзывов')}
          </span>
        )}
      </h2>
      {data.count === 0 ? (
        <p className={s.muted}>Опубликованных отзывов пока нет. Отзывы оставляют покупатели после доставки, публикует модератор.</p>
      ) : (
        <p className={s.muted}>Можно ответить на отзыв один раз — ответ сразу появится на странице товара под отзывом. Исправить ответ — через поддержку.</p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {data.items.map((r) => (
          <article key={r.id} style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{r.author}</b>
              <Stars value={r.rating} />
              <span className={s.muted}>
                Размер: {REVIEW_FIT_LABEL[r.fit].toLowerCase()} · {day(r.publishedAt)}
              </span>
            </div>
            <p style={{ margin: '8px 0 0', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{r.text}</p>
            {r.photos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {r.photos.map((ph) => ph.url && <img key={ph.url} src={ph.url} alt="" width={72} height={72} style={{ objectFit: 'cover', borderRadius: 8 }} />)}
              </div>
            )}
            {r.reply ? (
              <p style={{ margin: '10px 0 0', padding: '8px 12px', borderLeft: '3px solid var(--c-accent)', background: 'var(--c-surface-cream)' }}>
                <b>Ваш ответ:</b> {r.reply}
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                <label htmlFor={`${id}-${r.id}`} className={s.muted}>
                  Ответ продавца
                </label>
                <textarea
                  id={`${id}-${r.id}`}
                  className={s.input}
                  style={{ height: 72, padding: 10 }}
                  maxLength={1000}
                  value={draft[r.id] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })}
                  placeholder="Спасибо за отзыв!"
                />
                <div>
                  <Button
                    variant="outline"
                    disabled={busy || (draft[r.id] ?? '').trim().length < 2}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        setData(await api<Data>(`/supplier/products/${productId}/reviews/${r.id}/reply`, { text: draft[r.id].trim() }));
                      } catch (e) {
                        setError(isApiError(e) ? e.message : 'Ошибка');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Ответить
                  </Button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
