'use client';

import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ui';
import { onCartChange, readCart, setQty, type CartLine } from '@/lib/cart';

type V = { id: string; size: string; heightRange: string | null; color: string; price: number; oldPrice: number | null; stock: number; product: { slug: string; title: string; brand: string; supplier: string; image: string | null } };

/** Корзина гостя: состав и актуальные цены. Оформление, доставка и оплата — этап 4. */
export function CartView() {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [variants, setVariants] = useState<Map<string, V>>(new Map());
  useEffect(() => {
    const update = () => setLines(readCart());
    update();
    return onCartChange(update);
  }, []);
  useEffect(() => {
    if (!lines?.length) return;
    fetch(`/api/catalog/variants?ids=${lines.map((l) => l.variantId).join(',')}`)
      .then((r) => r.json())
      .then((rows: V[]) => setVariants(new Map(rows.map((v) => [v.id, v]))));
  }, [lines]);

  if (lines === null) return null;
  const items = lines.map((l) => ({ line: l, v: variants.get(l.variantId) })).filter((x) => x.v);
  const total = items.reduce((s, x) => s + x.v!.price * Math.min(x.line.qty, x.v!.stock), 0);
  const count = items.reduce((s, x) => s + x.line.qty, 0);

  return (
    <section className="container" style={{ padding: '40px var(--gutter)' }}>
      <div className="eyebrow">Корзина — доставка — оплата</div>
      <h1 style={{ fontSize: 48, margin: '10px 0 24px' }}>Почти у вас.</h1>
      {!lines.length ? (
        <div style={{ background: 'var(--c-surface-soft)', borderRadius: 20, padding: 32 }}>
          <h2 style={{ fontSize: 28 }}>В корзине пока пусто.</h2>
          <Link href="/catalog" style={{ color: 'var(--c-sale)', textDecoration: 'none' }}>
            Вернуться к покупкам →
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24, alignItems: 'start' }} className="cart-grid">
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map(({ line, v }) => (
              <div key={line.variantId} style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 16, alignItems: 'center', background: 'var(--c-surface)', borderRadius: 16, padding: 12 }}>
                {v!.product.image ? <img src={v!.product.image} alt="" style={{ width: 72, height: 90, objectFit: 'cover', borderRadius: 10 }} /> : <span />}
                <div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                    {v!.product.brand} · {v!.size}
                    {v!.heightRange && ` · ${v!.heightRange}`} · {v!.color}
                  </div>
                  <Link href={`/product/${v!.product.slug}`} style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--c-primary)', textDecoration: 'none' }}>
                    {v!.product.title}
                  </Link>
                  <div style={{ fontWeight: 700, marginTop: 6 }}>{formatRub(v!.price)}</div>
                  {line.qty > v!.stock && <div style={{ color: 'var(--c-sale)', fontSize: 13 }}>Осталось только {v!.stock} шт.</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button aria-label="Меньше" onClick={() => setQty(line.variantId, line.qty - 1)} style={qtyBtn}>
                    −
                  </button>
                  <span>{line.qty}</span>
                  <button aria-label="Больше" onClick={() => setQty(line.variantId, Math.min(v!.stock, line.qty + 1))} style={qtyBtn}>
                    +
                  </button>
                  <button onClick={() => setQty(line.variantId, 0)} style={{ border: 0, background: 'none', color: 'var(--c-sale)', cursor: 'pointer', marginLeft: 8 }}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
            <p style={{ fontSize: 14, color: 'var(--c-text-muted)' }}>Отправления сформируются по поставщикам на шаге доставки — каждый отгружает со своего склада.</p>
          </div>
          <aside style={{ background: 'var(--c-primary)', color: '#fff', borderRadius: 20, padding: 24, display: 'grid', gap: 12 }}>
            <h2 style={{ color: '#fff', fontSize: 30 }}>Ваш заказ</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>Товары · {count}</span>
              <b>{formatRub(total)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>Доставка</span>
              <span>Рассчитаем далее</span>
            </div>
            <ButtonLink href="/checkout" variant="accent">
              Перейти к оформлению
            </ButtonLink>
            <small style={{ opacity: 0.75 }}>Оформление и оплата заработают на этапе 4.</small>
          </aside>
        </div>
      )}
      <style>{`@media (max-width: 860px) { .cart-grid { grid-template-columns: 1fr !important; } }`}</style>
    </section>
  );
}

const qtyBtn = { width: 32, height: 32, borderRadius: 16, border: '1px solid var(--c-border-strong)', background: 'var(--c-surface)', cursor: 'pointer' } as const;
