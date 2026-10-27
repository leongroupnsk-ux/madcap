'use client';

import { useEffect, useState } from 'react';
import { onFavoritesChange, readFavorites } from '@/lib/favorites';
import s from './site.module.css';

/** Счётчик избранного в шапке — как CartCount: из браузера, обновляется по событию изменения списка (FavoritesSync, сердечко). */
export function FavoritesCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => setN(readFavorites().length);
    update();
    return onFavoritesChange(update);
  }, []);
  return n > 0 ? <span className={s.badge}>{n}</span> : null;
}
