'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ButtonLink } from '@/components/ui';
import { api } from '@/lib/api';
import { onCartChange, readCart, rememberPrices, setQty, writeCart, type CartLine } from '@/lib/cart';
import o from '@/components/shop/order.module.css';

export type CheckedItem = {
  variantId: string;
  qty: number;
  fromCapsule: boolean;
  available: boolean;
  stock: number;
  price: number;
  oldPrice: number | null;
  size: string;
  heightRange: string | null;
  color: string;
  product: { slug: string; title: string; brand: string; image: string | null };
  supplier: { id: string; name: string; city: string | null };
};

/** Корзина (ТЗ §6.1): при открытии сверяем цены и остатки, изменившиеся позиции подсвечиваем. */
export function CartView({ signedIn }: { signedIn: boolean }) {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [items, setItems] = useState<Map<string, CheckedItem>>(new Map());
  const [changed, setChanged] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const update = () => setLines(readCart());
    update();
    return onCartChange(update);
  }, []);

  const key = lines?.map((l) => l.variantId).sort().join(',') ?? '';
  useEffect(() => {
    const current = readCart();
    if (!current.length) return;
    api<{ items: CheckedItem[] }>('/cart/check', { lines: current.map(({ variantId, qty, fromCapsule }) => ({ variantId, qty: Math.min(qty, 99), fromCapsule })) })
      .then((r) => {
        const map = new Map(r.items.map((i) => [i.variantId, i]));
        setItems(map);
        // Варианты, которых больше нет в каталоге, убираем из корзины совсем.
        if (current.some((l) => !map.has(l.variantId))) writeCart(readCart().filter((l) => map.has(l.variantId)));
        // Цена изменилась с момента добавления — показываем прежнюю, затем запоминаем новую.
        const diff = new Map<string, number>();
        for (const l of current) {
          const now = map.get(l.variantId);
          if (now && l.price !== undefined && l.price !== now.price) diff.set(l.variantId, l.price);
        }
        if (diff.size) setChanged((prev) => new Map([...prev, ...diff]));
        rememberPrices(new Map(r.items.map((i) => [i.variantId, i.price])));
      })
      .catch(() => undefined);
  }, [key]);

  const rows = useMemo(() => (lines ?? []).map((l) => ({ line: l, item: items.get(l.variantId) })).filter((x) => x.item), [lines, items]);
  if (lines === null) return null;

  const ok = rows.filter((r) => r.item!.available);
  const total = ok.reduce((s, r) => s + r.item!.price * Math.min(r.line.qty, r.item!.stock), 0);
  const count = ok.reduce((s, r) => s + Math.min(r.line.qty, r.item!.stock), 0);
  const blocked = rows.some((r) => !r.item!.available || r.line.qty > r.item!.stock);
  const capsule = rows.filter((r) => r.line.fromCapsule);
  const regular = rows.filter((r) => !r.line.fromCapsule);
  const suppliers = new Set(ok.map((r) => r.item!.supplier.id)).size;

  const lineView = ({ line, item }: (typeof rows)[number]) => {
    const it = item!;
    const was = changed.get(line.variantId);
    const over = it.available && line.qty > it.stock;
    return (
      <div key={line.variantId} className={`${o.line} ${was !== undefined || over ? o.changed : ''} ${!it.available ? o.dim : ''}`}>
        {it.product.image ? <img src={it.product.image} alt="" className={o.thumb} /> : <span className={o.thumb} />}
        <div style={{ minWidth: 0 }}>
          <div className={o.meta}>
            {it.product.brand} · {it.size}
            {it.heightRange && ` · ${it.heightRange}`} · {it.color}
          </div>
          <Link href={`/product/${it.product.slug}`} className={o.name}>
            {it.product.title}
          </Link>
          <span className={o.price}>{formatRub(it.price)}</span>
          {it.oldPrice && it.oldPrice > it.price && <span className={o.old}>{formatRub(it.oldPrice)}</span>}
          {was !== undefined && <div className={o.warn}>Цена изменилась: было {formatRub(was)}</div>}
          {!it.available && <div className={o.warn}>Нет в наличии — удалите из корзины</div>}
          {over && <div className={o.warn}>Осталось только {it.stock} шт. — уменьшите количество</div>}
        </div>
        <div className={o.qty}>
          <button aria-label="Меньше" onClick={() => setQty(line.variantId, line.qty - 1)} disabled={!it.available}>
            −
          </button>
          <span aria-label="Количество">{line.qty}</span>
          <button aria-label="Больше" onClick={() => setQty(line.variantId, line.qty + 1)} disabled={!it.available || line.qty >= it.stock}>
            +
          </button>
          <button className={o.link} style={{ marginLeft: 8 }} onClick={() => setQty(line.variantId, 0)}>
            Удалить
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className={`container ${o.page}`}>
      <Link href="/catalog" className={o.back}>
        ← Вернуться к покупкам
      </Link>
      <div className={o.steps} style={{ marginTop: 16 }}>
        <b>Корзина</b> — Доставка — Оплата
      </div>
      <h1 className={o.title}>Почти у вас.</h1>
      {!lines.length ? (
        <div className={o.empty}>
          <h2>В корзине пока пусто.</h2>
          <Link href="/catalog" className={o.link}>
            Вернуться к покупкам →
          </Link>
        </div>
      ) : (
        <div className={o.layout}>
          <div className={o.stack}>
            {capsule.length > 0 && (
              <div className={o.panel}>
                <div className={o.panelHead}>
                  <span className={o.chip}>✦ Персональная капсула</span>
                  <span className={o.muted}>
                    {capsule.length} {plural(capsule.length, 'вещь', 'вещи', 'вещей')}
                  </span>
                </div>
                {capsule.map(lineView)}
              </div>
            )}
            {regular.length > 0 && <div className={o.panel}>{regular.map(lineView)}</div>}
            <p className={o.muted}>Отправления сформируются по поставщикам на шаге доставки — каждый отгружает со своего склада.</p>
          </div>
          <aside className={o.summary}>
            <h2>Ваш заказ</h2>
            <div className={o.row}>
              <span>Товары · {count}</span>
              <b>{formatRub(total)}</b>
            </div>
            <div className={o.row}>
              <span>Доставка</span>
              <span>Рассчитаем далее</span>
            </div>
            {suppliers > 1 && <div className={o.small}>Придёт {suppliers} {plural(suppliers, 'отправлением', 'отправлениями', 'отправлениями')} от разных поставщиков.</div>}
            <div className={o.total}>
              <span>Итого</span>
              <b>{formatRub(total)}</b>
            </div>
            {blocked ? (
              <div className={o.small}>Исправьте отмеченные позиции, чтобы продолжить.</div>
            ) : (
              <ButtonLink href={signedIn ? '/checkout' : '/login?next=/checkout'} variant="accent">
                Перейти к оформлению
              </ButtonLink>
            )}
            {!signedIn && !blocked && <div className={o.small}>Для оформления войдите или создайте аккаунт — корзина сохранится.</div>}
          </aside>
        </div>
      )}
    </section>
  );
}
