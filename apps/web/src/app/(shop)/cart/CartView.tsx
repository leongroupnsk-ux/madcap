'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { onCartChange, readCart, rememberPrices, setQty, writeCart, type CartLine } from '@/lib/cart';
import c from '@/components/shop/checkout.module.css';

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
      <div key={line.variantId} className={`${c.line} ${was !== undefined || over || !it.available ? c.lineChanged : ''} ${!it.available ? c.lineDim : ''}`}>
        <Link href={`/product/${it.product.slug}`} tabIndex={-1} aria-hidden>
          {it.product.image ? <img src={it.product.image} alt="" className={c.thumb} /> : <span className={c.thumb} style={{ display: 'block' }} />}
        </Link>
        <div className={c.lineBody}>
          <div className={c.lineMeta}>
            {it.product.brand.toUpperCase()} · {it.size}
            {it.heightRange && ` · ${it.heightRange}`} · {it.color}
          </div>
          <Link href={`/product/${it.product.slug}`} className={c.lineName}>
            {it.product.title}
          </Link>
          {was !== undefined && <div className={c.warn}>Цена изменилась: было {formatRub(was)}</div>}
          {!it.available && <div className={c.warn}>Нет в наличии — удалите из корзины</div>}
          {over && <div className={c.warn}>Осталось только {it.stock} шт. — уменьшите количество</div>}
          <div className={c.lineFoot}>
            <div>
              <span className={c.linePrice}>{formatRub(it.price)}</span>
              {it.oldPrice && it.oldPrice > it.price && <span className={c.lineOld}>{formatRub(it.oldPrice)}</span>}
            </div>
            <div className={c.lineCtrl}>
              <div className={c.stepper}>
                <button type="button" aria-label="Меньше" onClick={() => setQty(line.variantId, line.qty - 1)} disabled={!it.available}>
                  −
                </button>
                <span aria-label="Количество">{line.qty}</span>
                <button type="button" aria-label="Больше" onClick={() => setQty(line.variantId, line.qty + 1)} disabled={!it.available || line.qty >= it.stock}>
                  +
                </button>
              </div>
              <button type="button" className={c.remove} onClick={() => setQty(line.variantId, 0)}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className={c.page}>
      {/* В пустой корзине (.Cart-null) ссылка «назад» есть внутри плашки — сверху её нет */}
      {lines.length > 0 && (
        <Link href="/catalog" className={c.back}>
          ← Вернуться к покупкам
        </Link>
      )}
      <div className={c.steps} style={lines.length ? undefined : { paddingTop: 0 }}>
        <b>Корзина</b> — Доставка — Оплата
      </div>
      <h1 className={c.title}>Почти у вас.</h1>
      {!lines.length ? (
        <div className={c.empty}>
          <h2>В корзине пока пусто.</h2>
          <Link href="/catalog" className={c.emptyLink}>
            Вернуться к покупкам →
          </Link>
        </div>
      ) : (
        <div className={c.layout}>
          <div className={c.main}>
            {capsule.length > 0 && (
              <>
                <div className={c.capsuleHead}>
                  <span className={c.chip}>Персональная капсула</span>
                </div>
                <div className={c.lines}>{capsule.map(lineView)}</div>
              </>
            )}
            {regular.length > 0 && <div className={c.lines}>{regular.map(lineView)}</div>}
            <p className={c.note}>
              {suppliers > 1
                ? `Придёт ${suppliers} ${plural(suppliers, 'отправлением', 'отправлениями', 'отправлениями')}: отправления сформируются по поставщикам на шаге доставки — каждый отгружает со своего склада.`
                : 'Отправления сформируются по поставщикам на шаге доставки — каждый отгружает со своего склада.'}
            </p>
          </div>
          <aside className={c.summary}>
            <h2>Ваш заказ</h2>
            <div className={c.row}>
              <span>Товары · {count}</span>
              <b>{formatRub(total)}</b>
            </div>
            <div className={c.row}>
              <span>Доставка</span>
              <span>Рассчитаем далее</span>
            </div>
            <div className={c.total}>
              <span>Итого</span>
              <b>{formatRub(total)}</b>
            </div>
            {blocked ? (
              <>
                <button type="button" className={c.accent} disabled>
                  Перейти к оформлению
                </button>
                <div className={c.summaryHint}>Исправьте отмеченные позиции, чтобы продолжить.</div>
              </>
            ) : (
              <Link href={signedIn ? '/checkout' : '/login?next=/checkout'} className={c.accent}>
                Перейти к оформлению
              </Link>
            )}
            {!signedIn && !blocked && <div className={c.summaryHint}>Для оформления войдите или создайте аккаунт — корзина сохранится.</div>}
          </aside>
        </div>
      )}
    </section>
  );
}
