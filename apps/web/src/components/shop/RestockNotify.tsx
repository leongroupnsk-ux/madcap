'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, isApiError } from '@/lib/api';
import r from './reviews.module.css';

/** Подписки вошедшего на варианты открытого товара — одна загрузка на страницу */
const cache = new Map<string, Promise<string[]>>();
const mySubscriptions = (productId: string) => {
  let p = cache.get(productId);
  if (!p) {
    p = api<string[]>(`/me/restock/product/${productId}`).catch(() => []);
    cache.set(productId, p);
  }
  return p;
};

/**
 * «Сообщить о поступлении» вместо «В корзину», когда выбранного варианта нет в наличии.
 * Вошедший подписывается одним кликом на свой email; гость вводит email и даёт согласие на его обработку.
 */
export function RestockNotify({ variantId, productId, viewer, rowClass, buttonClass, children }: {
  variantId: string; productId: string; viewer: { email: string } | null; rowClass: string; buttonClass: string; children?: ReactNode;
}) {
  const id = useId();
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    void mySubscriptions(productId).then((ids) => alive && ids.includes(variantId) && setDone(viewer.email));
    return () => {
      alive = false;
    };
  }, [viewer, productId, variantId]);

  const subscribe = async (body: { variantId: string; email?: string; consent?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email: string }>('/restock', body);
      cache.delete(productId);
      setDone(res.email);
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={rowClass}>
        {done ? (
          <span className={buttonClass} role="status" style={{ cursor: 'default' }}>
            ✓ Сообщим о поступлении
          </span>
        ) : (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            aria-expanded={viewer ? undefined : open}
            aria-controls={viewer ? undefined : `${id}-form`}
            onClick={() => (viewer ? subscribe({ variantId }) : setOpen((v) => !v))}
          >
            Сообщить о поступлении
          </button>
        )}
        {children}
      </div>
      {done && <p className={r.notifyDone}>Пришлём письмо на {done}, когда этот размер и цвет появятся в наличии. Отписаться можно по ссылке из письма.</p>}
      {!done && error && !open && (
        <p className={r.notifyError} role="alert">
          {error}
        </p>
      )}
      {!viewer && open && !done && (
        <form
          id={`${id}-form`}
          className={r.notifyForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (!consent) return setError('Нужно согласие на обработку email');
            void subscribe({ variantId, email: email.trim(), consent });
          }}
        >
          <p>Пришлём одно письмо, когда товар снова появится. Без рассылок.</p>
          <div className={r.notifyRow}>
            <label htmlFor={`${id}-email`} className="visually-hidden">
              Email для уведомления
            </label>
            <input id={`${id}-email`} type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className={buttonClass} disabled={busy}>
              Подписаться
            </button>
          </div>
          <label className={r.notifyConsent}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            <span>
              Согласен на обработку email для этого уведомления по <Link href="/legal/privacy">политике персональных данных</Link>
            </span>
          </label>
          {error && (
            <p className={r.notifyError} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  );
}
