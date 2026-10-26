'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { addToCart } from '@/lib/cart';
import type { ProductDetails } from '@/lib/catalog';
import { COLOR_EVENT } from './Gallery';
import { FavButton } from './FavButton';
import { RestockNotify } from './RestockNotify';
import { Stars } from './Stars';
import r from './reviews.module.css';
import { SizeChart } from './SizeChart';
import p from './product.module.css';

/** Выбор цвета → размера → ростовки; недоступные сочетания неактивны (ТЗ §4.5). */
export function ProductBuy({ product, viewer = null }: { product: ProductDetails; viewer?: { email: string } | null }) {
  const vs = product.variants;
  const colors = useMemo(() => [...new Map(vs.map((v) => [v.color.id, v.color])).values()], [vs]);
  const rec = product.recommended;
  // Стартовый выбор — размер и ростовка из профиля, если они есть в наличии (ТЗ §4.5).
  const firstInStock =
    vs.find((v) => v.stock > 0 && rec?.size && v.size.toUpperCase() === rec.size.toUpperCase() && (!v.heightRange || v.heightRange === rec.heightRange)) ??
    vs.find((v) => v.stock > 0) ??
    vs[0];
  const [colorId, setColorId] = useState(firstInStock.color.id);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(COLOR_EVENT, { detail: colorId }));
  }, [colorId]);
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
  // «Стирка 60°» как в макете — из «до 60° · 600+ циклов» берём температуру
  const washDeg = product.washing?.match(/(\d+)\s*°/)?.[1];
  const ship = product.seller.shipDays <= 1 ? 'отгрузка завтра' : `отгрузка через ${product.seller.shipDays} дн.`;

  return (
    <div className={p.info}>
      <div className={p.meta}>
        {product.brand.name.toUpperCase()}
        {product.externalId && ` · арт. ${product.externalId}`}
      </div>
      <h1 className={p.title}>
        {product.title}, {color.name.toLowerCase()}
      </h1>
      <div className={p.tags}>
        {product.fits && <span className={`${p.tag} ${p.tagFit}`}>Подходит вам</span>}
        {product.treatment && <span className={p.tag}>{product.treatment}</span>}
        {product.washing && <span className={p.tag}>Стирка {washDeg ? `${washDeg}°` : product.washing}</span>}
      </div>
      <div className={r.headRow}>
        {product.reviews && product.reviews.count > 0 && (
          <a href="#reviews" className={r.ratingLink}>
            <Stars value={product.reviews.avg ?? 0} />
            <span>
              {(product.reviews.avg ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 1 })} · {product.reviews.count} {plural(product.reviews.count, 'отзыв', 'отзыва', 'отзывов')}
            </span>
          </a>
        )}
        <FavButton productId={product.id} title={product.title} variant="page" />
      </div>
      <div className={p.priceRow}>
        <span className={p.price}>{formatRub(price)}</span>
        {oldPrice && <span className={p.old}>{formatRub(oldPrice)}</span>}
        {product.category.slug === 'kostyumy' && <span className={p.priceNote}>топ + брюки в комплекте</span>}
      </div>
      {product.promo && (
        <div className={p.promo}>
          Акция «{product.promo.badge}» — цена действует до {new Date(product.promo.endsAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
        </div>
      )}

      <div className={p.group}>
        <div className={p.label}>
          {/* Название цвета уже в заголовке товара — в подписи, как в макете, только «Цвет» */}
          <span>Цвет</span>
        </div>
        <div className={p.swatches}>
          {colors.map((c) => (
            <button key={c.id} type="button" className={`${p.swatch} ${c.id === colorId ? p.swatchOn : ''}`} style={{ background: c.hex }} onClick={() => pickColor(c.id)} aria-label={c.name} aria-pressed={c.id === colorId} title={c.name} />
          ))}
        </div>
      </div>

      <div className={p.group}>
        <div className={p.label}>
          <span>Размер</span>
          <button type="button" className={p.chartLink} onClick={() => setChart(isShoes ? 'shoes' : 'clothes')}>
            Таблица размеров
          </button>
        </div>
        <div className={p.sizes}>
          {sizes.map((s) => (
            <button
              key={s}
              type="button"
              className={`${p.size} ${s === size ? p.sizeOn : ''} ${sizeAvailable(s) ? '' : p.sizeOut}`}
              onClick={() => pickSize(s)}
              aria-pressed={s === size}
              aria-label={sizeAvailable(s) ? undefined : `${s} — нет в наличии`}
            >
              {s}
              {rec?.size?.toUpperCase() === s.toUpperCase() && <small className={p.rec}>Рекомендуем</small>}
            </button>
          ))}
        </div>
      </div>

      {heights.length > 0 && (
        <div className={p.group}>
          <div className={p.label}>
            <span>Ростовка</span>
          </div>
          <div className={p.sizes}>
            {heights.map((h) => {
              const ok = ofColor.some((v) => v.size === size && v.heightRange === h && v.stock > 0);
              return (
                <button key={h} type="button" className={`${p.size} ${p.sizeWide} ${h === height ? p.sizeOn : ''} ${ok ? '' : p.sizeOut}`} aria-label={ok ? undefined : `${h} — нет в наличии`} onClick={() => {
                    setHeight(h);
                    setAdded(false);
                  }} aria-pressed={h === height}>
                  {h}
                  {rec?.heightRange === h && <small className={p.rec}>Рекомендуем</small>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={p.stock}>
        {variant && variant.stock > 0
          ? `${size}${height ? ` · ${height}` : ''} в наличии: ${variant.stock} шт., ${ship}`
          : variant
            ? `${size}${height ? ` · ${height}` : ''} — нет в наличии. Сообщим, когда появится`
            : 'Этого сочетания нет в наличии — выберите другой размер или цвет'}
      </div>

      {variant && variant.stock === 0 ? (
        // Вместо «В корзину» — подписка на поступление выбранного варианта (цвет + размер + ростовка)
        <RestockNotify key={variant.id} variantId={variant.id} productId={product.id} viewer={viewer} rowClass={p.buy} buttonClass={p.toCart}>
          <Link href="/quiz/1" className={p.toCapsule}>
            Добавить в капсулу
          </Link>
        </RestockNotify>
      ) : (
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
          {/* Состояние «в корзине» — компонент button-in-cart (Figma 32:4840): повторное нажатие ведёт в корзину */}
          {added ? (
            <Link href="/cart" className={`${p.toCart} ${p.toCartOn}`} aria-live="polite">
              ✓ Добавлено в корзину
            </Link>
          ) : (
            <button
              type="button"
              className={p.toCart}
              disabled={!variant || variant.stock === 0}
              onClick={() => {
                addToCart(variant!.id, Math.min(qty, variant!.stock), variant!.price);
                setAdded(true);
              }}
            >
              Добавить в корзину
            </button>
          )}
          <Link href="/quiz/1" className={p.toCapsule}>
            Добавить в капсулу
          </Link>
        </div>
      )}

      <div className={p.delivery}>
        <img src="/design/icons/delivery.svg" alt="" width={20} height={20} />
        <span>
          <b>СДЭК: пункт выдачи или курьер</b>
          <small>
            Со склада поставщика{product.seller.city ? ` в ${product.seller.city === 'Москва' ? 'Москве' : product.seller.city}` : ''} · срок и цена — при оформлении
          </small>
        </span>
      </div>

      {chart && <SizeChart chart={product.sizeChart} initial={chart} onClose={() => setChart(null)} />}
    </div>
  );
}
