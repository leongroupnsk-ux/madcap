'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import r from '@/components/shop/reviews.module.css';
import { Alert } from '@/components/ui';
import { api } from '@/lib/api';
import { onFavoritesChange, readFavorites, toggleFavorite } from '@/lib/favorites';
import { CARD_SIZES, imgSet, type ImageSet } from '@/lib/image';
import p from '../profile.module.css';

type Item = { id: string; slug: string; title: string; brand: string; image: string | null; imageSet: ImageSet | null; price: number; oldPrice: number | null; color: string; available: boolean };
type Sub = { id: string; variantId: string; product: { title: string; slug: string }; variant: string; createdAt: string };

/** Страница «Избранное» (макета нет — в стиле профиля): карточки с удалением и пометкой «нет в наличии» */
export function Favorites({ signedIn }: { signedIn: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ids = readFavorites();
    if (!ids.length) return setItems([]);
    try {
      const res = await api<{ items: Item[] }>(`/catalog/favorites?ids=${ids.join(',')}`);
      setItems(res.items);
    } catch {
      setError('Не удалось загрузить избранное. Обновите страницу.');
    }
  }, []);

  useEffect(() => {
    void load();
    return onFavoritesChange(() => void load());
  }, [load]);

  useEffect(() => {
    if (signedIn) api<Sub[]>('/me/restock').then(setSubs).catch(() => undefined);
  }, [signedIn]);

  const out = items?.filter((i) => !i.available).length ?? 0;
  return (
    <section className={p.page}>
      <Link href="/account" className={p.link}>
        ← Профиль
      </Link>
      <div className={p.eyebrow} style={{ marginTop: 16 }}>
        Мой профиль
      </div>
      <h1 className={p.title}>Избранное</h1>
      {items && items.length > 0 && (
        <p className={p.note}>
          {items.length} {plural(items.length, 'товар', 'товара', 'товаров')}
          {out > 0 && ` · ${out} нет в наличии`}
          {!signedIn && ' · войдите, чтобы избранное сохранилось в аккаунте'}
        </p>
      )}
      {error && (
        <div className={p.alert}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {items === null ? (
        <p className={p.note}>Загружаем…</p>
      ) : items.length === 0 ? (
        <div className={r.empty} style={{ marginTop: 24 }}>
          В избранном пока пусто. Нажмите ♡ на карточке товара, чтобы вернуться к нему позже.{' '}
          <Link href="/catalog" className={p.saleLink}>
            Перейти в каталог →
          </Link>
        </div>
      ) : (
        <ul className={r.favGrid} style={{ listStyle: 'none', padding: 0 }}>
          {items.map((i) => (
            <li key={i.id} className={`${r.favItem} ${i.available ? '' : r.favOut}`}>
              {i.image ? <img {...imgSet(i.imageSet, CARD_SIZES, i.image)} alt="" loading="lazy" decoding="async" /> : <span className={r.favNoImg} />}
              <div className={r.favBody}>
                <span className={r.favMeta}>{i.brand}</span>
                {i.available ? (
                  <Link href={`/product/${i.slug}`} className={r.favTitle}>
                    {i.title}
                  </Link>
                ) : (
                  <span className={r.favTitle}>{i.title}</span>
                )}
                <span className={r.favMeta}>{i.color}</span>
                {i.available ? (
                  <span className={r.favPrice}>
                    {formatRub(i.price)}
                    {i.oldPrice && <s style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: 'var(--c-text-strike)' }}>{formatRub(i.oldPrice)}</s>}
                  </span>
                ) : (
                  <span className={r.outBadge}>Нет в наличии</span>
                )}
                <div className={r.favActions}>
                  {i.available && (
                    <Link href={`/product/${i.slug}`} className={r.textBtn}>
                      Выбрать размер
                    </Link>
                  )}
                  <button type="button" className={r.textBtnMuted} onClick={() => void toggleFavorite(i.id)} aria-label={`Убрать «${i.title}» из избранного`}>
                    Убрать
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {signedIn && subs.length > 0 && (
        <div style={{ marginTop: 48 }}>
          <div className={p.eyebrow}>Сообщить о поступлении</div>
          <ul className={r.subs}>
            {subs.map((s) => (
              <li key={s.id}>
                <span>
                  <Link href={`/product/${s.product.slug}`}>{s.product.title}</Link> · {s.variant}
                </span>
                <button type="button" className={r.textBtnMuted} onClick={async () => setSubs(await api<Sub[]>(`/me/restock/${s.id}`, undefined, 'DELETE'))}>
                  Отписаться
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
