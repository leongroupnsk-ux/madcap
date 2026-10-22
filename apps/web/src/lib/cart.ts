'use client';

/** Корзина гостя в браузере (ТЗ §6.1). Перенос в аккаунт и резерв — этап 4. */
export type CartLine = { variantId: string; qty: number; fromCapsule?: boolean };
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

function write(lines: CartLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* приватный режим */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function addToCart(variantId: string, qty: number) {
  const lines = readCart();
  const line = lines.find((l) => l.variantId === variantId);
  if (line) line.qty += qty;
  else lines.push({ variantId, qty });
  write(lines);
}

/** Вся капсула одной группой (ТЗ §5.3): вещи помечаются «Персональная капсула». */
export function addCapsule(variantIds: string[]) {
  const lines = readCart();
  for (const id of variantIds) {
    const line = lines.find((l) => l.variantId === id);
    if (line) line.fromCapsule = true;
    else lines.push({ variantId: id, qty: 1, fromCapsule: true });
  }
  write(lines);
}

export function setQty(variantId: string, qty: number) {
  write(readCart().map((l) => (l.variantId === variantId ? { ...l, qty } : l)).filter((l) => l.qty > 0));
}

export function onCartChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
