'use client';

import { useState } from 'react';
import type { ProductDetails } from '@/lib/catalog';
import p from './product.module.css';

export function Gallery({ media, title }: { media: ProductDetails['media']; title: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [touchX, setTouchX] = useState<number | null>(null);
  const cur = media[i];
  if (!cur) return <div className={p.stage} />;
  return (
    <div className={p.gallery}>
      <div className={p.thumbs}>
        {media.map((m, n) => (
          <button key={m.id} type="button" className={`${p.thumb} ${n === i ? p.thumbOn : ''}`} onClick={() => setI(n)} aria-label={`Фото ${n + 1}`}>
            {m.thumbUrl && <img src={m.thumbUrl} alt="" />}
            {m.type === 'video' && <span className={p.play}>▶</span>}
          </button>
        ))}
      </div>
      <div
        className={p.stage}
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 40) setI((n) => (n + (dx < 0 ? 1 : media.length - 1)) % media.length);
          setTouchX(null);
        }}
      >
        {cur.type === 'video' ? (
          <video src={cur.url} poster={cur.posterUrl ?? undefined} controls playsInline muted />
        ) : (
          <img src={cur.url} alt={i === 0 ? title : `${title}, фото ${i + 1}`} onClick={() => setZoom(true)} />
        )}
      </div>
      {zoom && cur.type === 'photo' && (
        <div className={p.zoom} onClick={() => setZoom(false)} role="dialog" aria-label="Увеличенное фото">
          <img src={cur.url} alt={title} />
        </div>
      )}
    </div>
  );
}
