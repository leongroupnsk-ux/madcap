import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import type { Card } from '@/lib/catalog';
import s from './shop.module.css';

export function ProductCard({ p, priority }: { p: Card; priority?: boolean }) {
  const meta = [p.color, p.sizes, p.heightRange].filter(Boolean).join(' · ');
  return (
    <Link href={`/product/${p.slug}`} className={s.card}>
      <div className={s.media}>
        {(p.sale || p.fits) && (
          <div className={s.badges}>
            {p.sale && <span className={s.badgeSale}>Распродажа</span>}
            {p.fits && <span className={s.badgeFit}>Подходит вам</span>}
          </div>
        )}
        {p.images.filter(Boolean).slice(0, 2).map((src, i) => (
          <img key={i} src={src!} alt={i === 0 ? p.title : ''} loading={priority ? 'eager' : 'lazy'} />
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

export function ProductGrid({ items }: { items: Card[] }) {
  return (
    <div className={s.grid}>
      {items.map((p, i) => (
        <ProductCard key={p.id} p={p} priority={i < 5} />
      ))}
    </div>
  );
}
