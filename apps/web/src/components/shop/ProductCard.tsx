import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import type { Card } from '@/lib/catalog';
import s from './shop.module.css';

/**
 * priority — карточка в первом экране: фото грузится сразу (eager); lcp — первая карточка выдачи, её фото обычно
 * LCP-элемент на телефоне, поэтому fetchPriority="high". Второе фото (по наведению) всегда ленивое — не отнимает канал у первого.
 */
export function ProductCard({ p, priority, lcp }: { p: Card; priority?: boolean; lcp?: boolean }) {
  const meta = [p.color, p.sizes, p.heightRange].filter(Boolean).join(' · ');
  return (
    <Link href={`/product/${p.slug}`} className={s.card}>
      <div className={s.media}>
        {(p.sale || p.fits || p.promo) && (
          <div className={s.badges}>
            {p.promo ? <span className={s.badgeSale}>{p.promo}</span> : p.sale && <span className={s.badgeSale}>Распродажа</span>}
            {p.fits && <span className={s.badgeFit}>Подходит вам</span>}
          </div>
        )}
        {p.images.filter(Boolean).slice(0, 2).map((src, i) => (
          <img
            key={i}
            src={src!}
            alt={i === 0 ? p.title : ''}
            loading={priority && i === 0 ? 'eager' : 'lazy'}
            fetchPriority={lcp && i === 0 ? 'high' : i > 0 ? 'low' : undefined}
            decoding="async"
          />
        ))}
      </div>
      <div className={s.body}>
        <span className={s.brand}>{p.brand}</span>
        <span className={s.title}>{p.title}</span>
        <span className={s.meta}>{meta} в наличии</span>
        <span className={s.price}>
          {formatRub(p.price)}
          {p.oldPrice && <span className={s.old}>{formatRub(p.oldPrice)}</span>}
        </span>
      </div>
    </Link>
  );
}

/** eager — сетка в первом экране страницы (подборка); на главной сетки ниже хиро и грузятся лениво, не мешая LCP. */
export function ProductGrid({ items, eager = false }: { items: Card[]; eager?: boolean }) {
  return (
    <div className={s.grid}>
      {items.map((p, i) => (
        <ProductCard key={p.id} p={p} priority={eager && i < 5} lcp={eager && i === 0} />
      ))}
    </div>
  );
}
