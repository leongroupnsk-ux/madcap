'use client';

import { REVIEW_FIT_LABEL, REVIEW_FIT_SUMMARY, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ReviewsPage } from '@/lib/catalog';
import { imgSet } from '@/lib/image';
import { ReviewForm, type MyReview } from './ReviewForm';
import { Stars } from './Stars';
import r from './reviews.module.css';

const date = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const avgText = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Блок «Отзывы» на странице товара: средняя оценка, распределение по звёздам, посадка, список с фото
 * и ответом продавца, пагинация по 10. Первая страница приходит с сервера (SSR, видна поисковикам).
 * Вошедший покупатель с доставленным заказом видит «Написать отзыв».
 */
export function ProductReviews({ product, initial, signedIn }: { product: { id: string; slug: string; title: string }; initial: ReviewsPage; signedIn: boolean }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<{ canReview: boolean; review: MyReview | null } | null>(null);
  const [writing, setWriting] = useState(false);
  const [sent, setSent] = useState(false);
  const top = useRef<HTMLElement>(null);
  const s = data.summary;

  useEffect(() => {
    if (!signedIn) return;
    api<{ canReview: boolean; review: MyReview | null }>(`/me/reviews/product/${product.id}`)
      .then(setMine)
      .catch(() => undefined);
  }, [signedIn, product.id]);

  const go = async (page: number) => {
    setBusy(true);
    try {
      setData(await api<ReviewsPage>(`/catalog/products/${encodeURIComponent(product.slug)}/reviews?page=${page}`));
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="reviews" ref={top} className={r.reviews} aria-labelledby="reviews-title">
      <div className={r.reviewsHead}>
        <h2 id="reviews-title">
          Отзывы{s.count > 0 && <span className="visually-hidden"> · {s.count}</span>}
        </h2>
        {mine?.canReview && !sent && (
          <button type="button" className={r.writeBtn} onClick={() => setWriting(true)}>
            Написать отзыв
          </button>
        )}
        {mine?.review && !sent && <span className={r.writeNote}>Ваш отзыв {mine.review.status === 'approved' ? 'опубликован' : mine.review.status === 'pending' ? 'на модерации' : 'отклонён'} · <Link href="/account#reviews">в профиле</Link></span>}
        {sent && <span className={r.writeNote}>Спасибо! Отзыв появится после проверки модератором.</span>}
      </div>

      {s.count === 0 ? (
        <p className={r.empty} style={{ marginTop: 20 }}>
          Отзывов пока нет. Оставить отзыв можно после получения заказа — кнопка появится в профиле у доставленного заказа.
        </p>
      ) : (
        <div className={r.reviewsGrid}>
          <aside className={r.summary} aria-label="Сводка оценок">
            <div className={r.avg}>
              <b>{avgText(s.avg ?? 0)}</b>
              <div>
                <Stars value={s.avg ?? 0} size={18} />
                <small>
                  {s.count} {plural(s.count, 'отзыв', 'отзыва', 'отзывов')}
                </small>
              </div>
            </div>
            <ul className={r.dist} aria-label="Распределение оценок">
              {s.distribution.map((d) => (
                <li key={d.stars}>
                  <span>{d.stars} ★</span>
                  <span className={r.bar} role="img" aria-label={`${d.stars} звёзд — ${d.count} ${plural(d.count, 'отзыв', 'отзыва', 'отзывов')}`}>
                    <span style={{ width: `${s.count ? Math.round((d.count / s.count) * 100) : 0}%` }} />
                  </span>
                  <span>{d.count}</span>
                </li>
              ))}
            </ul>
            {s.fitMost && (
              <div className={r.fitNote}>
                Размер: {REVIEW_FIT_SUMMARY[s.fitMost]}
                <span>
                  {REVIEW_FIT_LABEL.small} — {s.fit.small} · {REVIEW_FIT_LABEL.true_to_size} — {s.fit.true_to_size} · {REVIEW_FIT_LABEL.large} — {s.fit.large}
                </span>
              </div>
            )}
          </aside>

          <div>
            <ul className={r.list} aria-busy={busy}>
              {data.items.map((it) => (
                <li key={it.id} className={r.item}>
                  <div className={r.itemHead}>
                    <b>{it.author}</b>
                    <Stars value={it.rating} />
                    <span className={r.fitChip}>Размер: {REVIEW_FIT_LABEL[it.fit].toLowerCase()}</span>
                    <time dateTime={it.publishedAt}>{date(it.publishedAt)}</time>
                  </div>
                  <p className={r.itemText}>{it.text}</p>
                  {it.photos.length > 0 && (
                    <div className={r.photos}>
                      {it.photos.map((ph, i) => (
                        <a key={ph.url} href={ph.url} target="_blank" rel="noreferrer" aria-label={`Фото ${i + 1} из отзыва ${it.author} — открыть`}>
                          <img {...imgSet(ph.image, '88px', ph.url)} alt="" loading="lazy" decoding="async" />
                        </a>
                      ))}
                    </div>
                  )}
                  {it.reply && (
                    <div className={r.reply}>
                      <b>Ответ продавца · {it.reply.seller}</b>
                      {it.reply.text}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {data.pages > 1 && (
              <nav className={r.pager} aria-label="Страницы отзывов">
                {Array.from({ length: data.pages }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" aria-current={n === data.page ? 'page' : undefined} disabled={busy || n === data.page} onClick={() => go(n)}>
                    {n}
                  </button>
                ))}
              </nav>
            )}
          </div>
        </div>
      )}

      {writing && (
        <ReviewForm
          product={{ id: product.id, title: product.title }}
          onClose={() => setWriting(false)}
          onSaved={(rev) => {
            setWriting(false);
            setSent(true);
            setMine({ canReview: false, review: rev });
          }}
        />
      )}
    </section>
  );
}
