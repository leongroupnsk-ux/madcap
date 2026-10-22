'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import { mergeLines, onCartChange, readCart, writeCart, type CartLine } from '@/lib/cart';

/** У вошедшего корзина хранится и на сервере: при входе корзины объединяются, дальше — синхронизация (ТЗ §6.1). */
export function CartSync({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    const push = () => {
      if (!ready) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const lines = readCart().map(({ variantId, qty, fromCapsule }) => ({ variantId, qty, fromCapsule }));
        void api('/cart', { lines }, 'PUT').catch(() => undefined);
      }, 400);
    };
    const off = onCartChange(push);
    const owner = localStorage.getItem('cart-owner');
    api<{ lines: CartLine[] }>('/cart')
      .then((server) => {
        // Корзина другого аккаунта в этом браузере не смешивается с текущей.
        const local = owner && owner !== userId ? [] : readCart();
        const merged = mergeLines(server.lines, local);
        localStorage.setItem('cart-owner', userId);
        ready = true;
        writeCart(merged);
      })
      .catch(() => undefined);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [userId]);
  return null;
}
