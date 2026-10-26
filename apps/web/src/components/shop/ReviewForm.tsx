'use client';

import { REVIEW_FITS, REVIEW_FIT_LABEL, REVIEW_MAX_PHOTOS, type ReviewFit } from '@aesculap/shared';
import { useId, useRef, useState } from 'react';
import { Alert, Button, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import r from './reviews.module.css';

export type MyReview = {
  id: string; productId: string; product: { slug: string; title: string }; rating: number; fit: ReviewFit; text: string;
  photos: { key: string; url: string | null }[]; status: 'pending' | 'approved' | 'rejected'; rejectReason: string | null; reply: string | null;
  createdAt: string; updatedAt: string;
};

const RATING_WORDS = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'];

/**
 * Форма отзыва в модальном окне: оценка, «размер подошёл», текст 10–2000 символов, до 3 фото.
 * Новый и отредактированный отзыв уходит на модерацию.
 */
export function ReviewForm({ product, initial, onClose, onSaved }: { product: { id: string; title: string }; initial?: MyReview | null; onClose: () => void; onSaved: (r: MyReview) => void }) {
  const id = useId();
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [fit, setFit] = useState<ReviewFit | null>(initial?.fit ?? null);
  const [text, setText] = useState(initial?.text ?? '');
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[]>(initial?.photos ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const upload = async (f: File) => {
    const form = new FormData();
    form.append('file', f);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ key: string; url: string | null }>('/me/reviews/photos', form);
      setPhotos((p) => [...p, res].slice(0, REVIEW_MAX_PHOTOS));
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Не удалось загрузить фото');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!rating) errs.rating = 'Поставьте оценку';
    if (!fit) errs.fit = 'Отметьте, подошёл ли размер';
    if (text.trim().length < 10) errs.text = 'Напишите хотя бы 10 символов';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      const body = { rating, fit, text: text.trim(), photos: photos.map((p) => p.key) };
      const saved = initial ? await api<MyReview>(`/me/reviews/${initial.id}`, body, 'PUT') : await api<MyReview>('/me/reviews', { ...body, productId: product.id });
      onSaved(saved);
    } catch (e) {
      if (isApiError(e) && e.errors) setErrors(e.errors);
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal eyebrow={initial ? 'Изменить отзыв' : 'Отзыв о товаре'} title={product.title} onClose={onClose}>
      <div className={r.form}>
        <fieldset className={r.fieldset} aria-describedby={errors.rating ? `${id}-rating` : undefined}>
          <legend className={r.legend}>Оценка{rating ? ` · ${RATING_WORDS[rating]}` : ''}</legend>
          <div className={r.rateRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={n <= rating ? r.rateOn : undefined}>
                <input type="radio" name={`${id}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} из 5 — ${RATING_WORDS[n]}`} />
                <span aria-hidden>★</span>
              </label>
            ))}
          </div>
          {errors.rating && (
            <div id={`${id}-rating`} className={r.fieldError}>
              {errors.rating}
            </div>
          )}
        </fieldset>

        <fieldset className={r.fieldset}>
          <legend className={r.legend}>Размер подошёл?</legend>
          <div className={r.fitRow}>
            {REVIEW_FITS.map((f) => (
              <label key={f}>
                <input type="radio" name={`${id}-fit`} value={f} checked={fit === f} onChange={() => setFit(f)} />
                <span>{REVIEW_FIT_LABEL[f]}</span>
              </label>
            ))}
          </div>
          {errors.fit && <div className={r.fieldError}>{errors.fit}</div>}
        </fieldset>

        <div>
          <label htmlFor={`${id}-text`} className={r.legend} style={{ display: 'block' }}>
            Отзыв
          </label>
          <textarea
            id={`${id}-text`}
            className={r.textarea}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Как сидит, как ведёт себя ткань после стирок, удобно ли на смене"
            aria-invalid={Boolean(errors.text)}
            aria-describedby={`${id}-count`}
          />
          <div id={`${id}-count`} className={r.counter}>
            {text.trim().length} / 2000
          </div>
          {errors.text && <div className={r.fieldError}>{errors.text}</div>}
        </div>

        <div>
          <div className={r.legend}>Фото · до {REVIEW_MAX_PHOTOS}</div>
          <div className={r.formPhotos}>
            {photos.map((p) => (
              <div key={p.key} className={r.formPhoto}>
                {p.url && <img src={p.url} alt="" />}
                <button type="button" aria-label="Убрать фото" onClick={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}>
                  ×
                </button>
              </div>
            ))}
            {photos.length < REVIEW_MAX_PHOTOS && (
              <button type="button" className={r.addPhoto} disabled={busy} onClick={() => file.current?.click()}>
                + Фото
              </button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        <p className={r.writeNote}>Отзыв появится на странице товара после проверки модератором. Не указывайте телефоны, ссылки и личные данные.</p>
        <div className={r.formActions}>
          <Button disabled={busy} onClick={submit}>
            {initial ? 'Сохранить и отправить' : 'Отправить отзыв'}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  );
}
