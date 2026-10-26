'use client';

import { useEffect, useState } from 'react';
import { onFavoritesChange, readFavorites, toggleFavorite } from '@/lib/favorites';
import r from './reviews.module.css';

/** Сердечко «В избранное»: на карточке — круглая кнопка поверх фото, на странице товара — рядом с заголовком */
export function FavButton({ productId, title, variant = 'card' }: { productId: string; title: string; variant?: 'card' | 'page' }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readFavorites().includes(productId));
    sync();
    return onFavoritesChange(sync);
  }, [productId]);
  return (
    <button
      type="button"
      className={`${variant === 'card' ? r.favCard : r.favPage} ${on ? r.favOn : ''}`}
      aria-pressed={on}
      aria-label={on ? `Убрать «${title}» из избранного` : `Добавить «${title}» в избранное`}
      title={on ? 'В избранном' : 'В избранное'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOn(!on);
        void toggleFavorite(productId).then(setOn);
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
        <path
          d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.4 3.4 5 6.8 5c2 0 3.6 1.1 4.4 2.6h1.6C13.6 6.1 15.2 5 17.2 5c3.4 0 5.2 3.4 4.1 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
      {variant === 'page' && <span>{on ? 'В избранном' : 'В избранное'}</span>}
    </button>
  );
}
