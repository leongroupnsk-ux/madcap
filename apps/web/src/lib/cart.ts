'use client';

/**
 * Корзина (ТЗ §6.1). В браузере — у всех; у вошедшего дополнительно хранится на сервере
 * (синхронизация в CartSync), чтобы не терялась между устройствами и после входа.
 * price — цена на момент добавления: по ней подсвечиваем изменившиеся позиции.
 */
export type CartLine = { variantId: string; qty: number; fromCapsule?: boolean; price?: number };
const KEY = 'cart-v1';
const EVENT = 'cart-change';

export function readCart(): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((l) => typeof l?.variantId === 'string' && l.qty > 0) : [];
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* приватный режим */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function addToCart(variantId: string, qty: number, price?: number) {
  const lines = readCart();
  const line = lines.find((l) => l.variantId === variantId);
  if (line) line.qty += qty;
  else lines.push({ variantId, qty, price });
  writeCart(lines);
}

/** Вся капсула одной группой (ТЗ §5.3): вещи помечаются «Персональная капсула». */
export function addCapsule(items: { variantId: string; price?: number }[]) {
  const lines = readCart();
  for (const { variantId, price } of items) {
    const line = lines.find((l) => l.variantId === variantId);
    if (line) line.fromCapsule = true;
    else lines.push({ variantId, qty: 1, fromCapsule: true, price });
  }
  writeCart(lines);
}

export function setQty(variantId: string, qty: number) {
  writeCart(readCart().map((l) => (l.variantId === variantId ? { ...l, qty } : l)).filter((l) => l.qty > 0));
}

/** Запомнить актуальные цены после проверки — подсветка «цена изменилась» показывается один раз. */
export function rememberPrices(prices: Map<string, number>) {
  const lines = readCart();
  if (lines.every((l) => l.price === prices.get(l.variantId) || !prices.has(l.variantId))) return;
  writeCart(lines.map((l) => (prices.has(l.variantId) ? { ...l, price: prices.get(l.variantId) } : l)));
}

/** Объединение корзин гостя и аккаунта при входе: берётся большее количество. */
export function mergeLines(a: CartLine[], b: CartLine[]): CartLine[] {
  const out = new Map<string, CartLine>();
  for (const l of [...a, ...b]) {
    const prev = out.get(l.variantId);
    out.set(l.variantId, prev ? { ...prev, qty: Math.max(prev.qty, l.qty), fromCapsule: prev.fromCapsule || l.fromCapsule, price: prev.price ?? l.price } : { ...l });
  }
  return [...out.values()];
}

export function onCartChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
