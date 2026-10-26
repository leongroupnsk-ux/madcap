'use client';

import { api } from './api';

/**
 * Избранное. В браузере — у всех (id товаров); у вошедшего дополнительно в базе: при входе список гостя
 * переносится (FavoritesSync), дальше каждое нажатие сердечка сразу уходит на сервер.
 */
const KEY = 'favorites-v1';
const OWNER = 'favorites-owner';
const EVENT = 'favorites-change';
const LIMIT = 200;

/** Вошедший пользователь (ставит FavoritesSync): нажатия сердечка синхронизируются с сервером */
let currentUser: string | null = null;
export const setFavoritesUser = (id: string | null) => {
  currentUser = id;
};

export function readFavorites(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function writeFavorites(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)].slice(0, LIMIT)));
  } catch {
    /* приватный режим */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function favoritesOwner() {
  try {
    return localStorage.getItem(OWNER);
  } catch {
    return null;
  }
}

export function setFavoritesOwner(id: string | null) {
  try {
    if (id) localStorage.setItem(OWNER, id);
    else localStorage.removeItem(OWNER);
  } catch {
    /* приватный режим */
  }
}

/** Выход и удаление аккаунта: избранное аккаунта не остаётся в браузере */
export function clearFavorites() {
  writeFavorites([]);
  setFavoritesOwner(null);
  currentUser = null;
}

/** Добавить или убрать; у вошедшего — сразу на сервере (при ошибке локальное состояние откатывается) */
export async function toggleFavorite(productId: string): Promise<boolean> {
  const before = readFavorites();
  const on = !before.includes(productId);
  writeFavorites(on ? [productId, ...before] : before.filter((x) => x !== productId));
  if (currentUser) {
    try {
      const r = await api<{ ids: string[] }>(`/me/favorites/${productId}`, undefined, on ? 'PUT' : 'DELETE');
      writeFavorites(r.ids);
    } catch {
      writeFavorites(before);
      return !on;
    }
  }
  return on;
}

export function onFavoritesChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
