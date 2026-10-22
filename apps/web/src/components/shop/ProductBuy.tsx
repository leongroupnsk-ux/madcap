'use client';

import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, ButtonLink, Modal } from '@/components/ui';
import { addToCart } from '@/lib/cart';
import type { ProductDetails } from '@/lib/catalog';
import p from './product.module.css';

/** Выбор цвета → размера → ростовки; недоступные сочетания неактивны (ТЗ §4.5). */
export function ProductBuy({ product }: { product: ProductDetails }) {
  const vs = product.variants;
  const colors = useMemo(() => [...new Map(vs.map((v) => [v.color.id, v.color])).values()], [vs]);
  const firstInStock = vs.find((v) => v.stock > 0) ?? vs[0];
  const [colorId, setColorId] = useState(firstInStock.color.id);
  const ofColor = vs.filter((v) => v.color.id === colorId);
  const sizes = [...new Set(ofColor.map((v) => v.size))];
  const [size, setSize] = useState(firstInStock.size);
  const heights = [...new Set(ofColor.filter((v) => v.size === size).map((v) => v.heightRange).filter((h): h is string => Boolean(h)))];
  const [height, setHeight] = useState<string | null>(firstInStock.heightRange);
  const variant = ofColor.find((v) => v.size === size && (heights.length === 0 || v.heightRange === height));
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [chart, setChart] = useState<'clothes' | 'shoes' | null>(null);

  const pickColor = (id: string) => {
    setColorId(id);
    const v = vs.find((x) => x.color.id === id && x.size === size && x.stock > 0) ?? vs.find((x) => x.color.id === id && x.stock > 0) ?? vs.find((x) => x.color.id === id)!;
    setSize(v.size);
    setHeight(v.heightRange);
    setAdded(false);
  };
  const pickSize = (s: string) => {
    setSize(s);
    const v = ofColor.find((x) => x.size === s && x.heightRange === height && x.stock > 0) ?? ofColor.find((x) => x.size === s && x.stock > 0) ?? ofColor.find((x) => x.size === s)!;
    setHeight(v.heightRange);
    setAdded(false);
  };
  const sizeAvailable = (s: string) => ofColor.some((v) => v.size === s && v.stock > 0);
  const isShoes = sizes.every((s) => /^\d+$/.test(s));
  const price = variant?.price ?? firstInStock.price;
  const oldPrice = variant ? variant.oldPrice : firstInStock.oldPrice;
  const color = colors.find((c) => c.id === colorId)!;
  const ship = product.seller.shipDays <= 1 ? 'отгрузка завтра' : `отгрузка через ${product.seller.shipDays} дн.`;

  return (
    <div className={p.info}>
      <div className={p.meta}>
        {product.brand.name}
        {product.externalId && ` · арт. ${product.externalId}`}
      </div>
      <h1>
        {product.title}, {color.name.toLowerCase()}
      </h1>
      <div className={p.tags}>
        {product.treatment && <span className={p.tag}>{product.treatment}</span>}
        {product.washing && <span className={p.tag}>Стирка {product.washing}</span>}
      </div>
      <div className={p.priceRow}>
        <span className={p.price}>{formatRub(price)}</span>
        {oldPrice && <span className={p.old}>{formatRub(oldPrice)}</span>}
      </div>

      <div>
        <div className={p.label}>
          Цвет · <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginRight: 'auto', marginLeft: 6 }}>{color.name}</span>
        </div>
        <div className={p.swatches}>
          {colors.map((c) => (
            <button key={c.id} type="button" className={`${p.swatch} ${c.id === colorId ? p.swatchOn : ''}`} style={{ background: c.hex }} onClick={() => pickColor(c.id)} aria-label={c.name} aria-pressed={c.id === colorId} title={c.name} />
          ))}
        </div>
      </div>

      <div>
        <div className={p.label}>
          Размер
          <button type="button" onClick={() => setChart(isShoes ? 'shoes' : 'clothes')}>
            Таблица размеров
          </button>
        </div>
        <div className={p.sizes}>
          {sizes.map((s) => (
            <button key={s} type="button" className={`${p.size} ${s === size ? p.sizeOn : ''}`} onClick={() => pickSize(s)} disabled={!sizeAvailable(s)} aria-pressed={s === size}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {heights.length > 0 && (
        <div>
          <div className={p.label}>Ростовка</div>
          <div className={p.sizes}>
            {heights.map((h) => {
              const ok = ofColor.some((v) => v.size === size && v.heightRange === h && v.stock > 0);
              return (
                <button key={h} type="button" className={`${p.size} ${h === height ? p.sizeOn : ''}`} disabled={!ok} onClick={() => setHeight(h)} aria-pressed={h === height}>
                  {h}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={p.stock}>
        {variant && variant.stock > 0
          ? `${size}${height ? ` · ${height}` : ''} в наличии: ${variant.stock} шт., ${ship}`
          : 'Этого сочетания нет в наличии — выберите другой размер или цвет'}
      </div>

      <div className={p.buy}>
        <div className={p.qty}>
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Меньше">
            −
          </button>
          <span aria-live="polite">{qty}</span>
          <button type="button" onClick={() => setQty((q) => Math.min(variant?.stock ?? 1, q + 1))} aria-label="Больше">
            +
          </button>
        </div>
        <Button
          disabled={!variant || variant.stock === 0}
          onClick={() => {
            addToCart(variant!.id, Math.min(qty, variant!.stock));
            setAdded(true);
          }}
        >
          Добавить в корзину
        </Button>
        <ButtonLink href="/quiz/1" variant="soft">
          Добавить в капсулу
        </ButtonLink>
      </div>
      {added && (
        <div className={p.added}>
          ✓ Добавлено. <Link href="/cart">Перейти в корзину →</Link>
        </div>
      )}

      <div className={p.delivery}>
        <span aria-hidden>🚚</span>
        <span>
          <b>СДЭК: пункт выдачи или курьер</b>
          <small>
            Со склада поставщика{product.seller.city ? ` в ${product.seller.city === 'Москва' ? 'Москве' : product.seller.city}` : ''} · стоимость и срок рассчитаем при оформлении
          </small>
        </span>
      </div>

      {chart && (
        <Modal eyebrow="Информация" title="Таблица размеров" onClose={() => setChart(null)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['clothes', 'shoes'] as const).map((k) => (
              <Button key={k} variant={chart === k ? 'primary' : 'outline'} onClick={() => setChart(k)}>
                {k === 'clothes' ? 'Одежда' : 'Обувь'}
              </Button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className={p.chart}>
              <thead>
                <tr>
                  {product.sizeChart[chart].columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {product.sizeChart[chart].rows.map((r) => (
                  <tr key={r.join()}>
                    {r.map((c, i) => (
                      <td key={i}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
