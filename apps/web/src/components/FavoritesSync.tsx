'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import { favoritesOwner, readFavorites, setFavoritesOwner, setFavoritesUser, writeFavorites } from '@/lib/favorites';

/**
 * Избранное вошедшего хранится в базе: при входе список гостя из браузера переносится на сервер
 * (как корзина в CartSync), затем браузер получает объединённый список. Избранное другого аккаунта
 * в этом браузере с текущим не смешивается.
 */
export function FavoritesSync({ userId }: { userId: string | null }) {
  useEffect(() => {
    setFavoritesUser(userId);
    if (!userId) {
      // Сессия закончилась или выход в другой вкладке — избранное аккаунта не показываем гостю
      if (favoritesOwner()) {
        setFavoritesOwner(null);
        writeFavorites([]);
      }
      return;
    }
    const owner = favoritesOwner();
    // Уже синхронизированный браузер берёт список с сервера (удаления на другом устройстве не воскресают);
    // первый вход — переносит избранное гостя
    const load =
      owner === userId
        ? api<{ ids: string[] }>('/me/favorites/ids')
        : api<{ ids: string[] }>('/me/favorites/merge', { productIds: owner ? [] : readFavorites() });
    load
      .then((r) => {
        setFavoritesOwner(userId);
        writeFavorites(r.ids);
      })
      .catch(() => undefined);
  }, [userId]);
  return null;
}
