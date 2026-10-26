'use client';

import { REVIEW_FIT_LABEL, REVIEW_STATUS_LABEL } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ReviewForm, type MyReview } from '@/components/shop/ReviewForm';
import { Stars } from '@/components/shop/Stars';
import r from '@/components/shop/reviews.module.css';
import { api } from '@/lib/api';
import p from './profile.module.css';

type Data = { reviews: MyReview[]; eligible: { id: string; slug: string; title: string }[] };

/** «Мои отзывы» в профиле: статус модерации, причина отказа, правка; товары из доставленных заказов без отзыва */
export function MyReviews() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<{ product: { id: string; title: string }; initial: MyReview | null } | null>(null);

  const load = () =>
    api<Data>('/me/reviews')
      .then(setData)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  if (!data || (!data.reviews.length && !data.eligible.length)) return null;
  return (
    <div id="reviews" className={p.orders} style={{ scrollMarginTop: 96 }}>
      <div className={p.eyebrow}>Мои отзывы</div>
      {data.eligible.length > 0 && (
        <div className={r.mineItem}>
          <span>Вы получили эти товары — расскажите, как они вам:</span>
          <div className={r.eligible}>
            {data.eligible.map((e) => (
              <button key={e.id} type="button" className={r.writeBtn} onClick={() => setForm({ product: { id: e.id, title: e.title }, initial: null })}>
                Оставить отзыв · {e.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {data.reviews.map((rev) => (
        <div key={rev.id} className={r.mineItem}>
          <div className={r.mineHead}>
            <Link href={`/product/${rev.product.slug}`}>{rev.product.title}</Link>
            <span className={`${r.status} ${r[`status_${rev.status}`] ?? ''}`}>{REVIEW_STATUS_LABEL[rev.status]}</span>
          </div>
          <div className={r.itemHead}>
            <Stars value={rev.rating} />
            <span className={r.fitChip}>Размер: {REVIEW_FIT_LABEL[rev.fit].toLowerCase()}</span>
          </div>
          <p className={r.itemText} style={{ marginTop: 0 }}>
            {rev.text}
          </p>
          {rev.status === 'rejected' && rev.rejectReason && <p className={r.reject}>Причина отказа: {rev.rejectReason}</p>}
          {rev.reply && (
            <div className={r.reply}>
              <b>Ответ продавца</b>
              {rev.reply}
            </div>
          )}
          <div className={r.favActions} style={{ paddingTop: 4 }}>
            <button type="button" className={r.textBtn} onClick={() => setForm({ product: { id: rev.productId, title: rev.product.title }, initial: rev })}>
              {rev.status === 'rejected' ? 'Исправить и отправить снова' : 'Изменить'}
            </button>
            <button
              type="button"
              className={r.textBtnMuted}
              onClick={async () => {
                if (!confirm('Удалить отзыв?')) return;
                await api(`/me/reviews/${rev.id}`, undefined, 'DELETE');
                void load();
              }}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
      {form && (
        <ReviewForm
          product={form.product}
          initial={form.initial}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
