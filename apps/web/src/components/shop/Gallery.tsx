'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProductDetails } from '@/lib/catalog';
import { STAGE_SIZES, imgSet } from '@/lib/image';
import p from './product.module.css';

/** Событие выбора цвета в блоке покупки — галерея показывает фото этого цвета (ТЗ §4.3). */
export const COLOR_EVENT = 'product-color';

/** Галерея товара по макету: колонка превью 100 × 133 слева, большое фото 3 : 4 справа; на телефоне превью — лентой снизу. */
export function Gallery({ media: all, title, initialColorId }: { media: ProductDetails['media']; title: string; initialColorId?: string | null }) {
  const [colorId, setColorId] = useState(initialColorId ?? null);
  useEffect(() => {
    const on = (e: Event) => setColorId((e as CustomEvent<string>).detail);
    window.addEventListener(COLOR_EVENT, on);
    return () => window.removeEventListener(COLOR_EVENT, on);
  }, []);
  // Фото выбранного цвета, иначе общие; видео показываются всегда
  const media = useMemo(() => {
    const photos = all.filter((m) => m.type === 'photo');
    const own = photos.filter((m) => colorId && m.colorId === colorId);
    const common = photos.filter((m) => !m.colorId);
    const shown = own.length ? [...own, ...common] : common.length ? common : photos;
    return [...shown, ...all.filter((m) => m.type === 'video')];
  }, [all, colorId]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [colorId]);
  const [zoom, setZoom] = useState(false);
  const [touchX, setTouchX] = useState<number | null>(null);
  const cur = media[i];
  if (!cur) return <div className={p.stage} />;
  return (
    <div className={p.gallery}>
      <div className={p.thumbs}>
        <div className={p.thumbList}>
          {media.map((m, n) => (
            <button key={m.id} type="button" className={`${p.thumb} ${n === i ? p.thumbOn : ''}`} onClick={() => setI(n)} aria-label={`${m.type === 'video' ? 'Видео' : 'Фото'} ${n + 1}`} aria-pressed={n === i}>
              {(m.thumbUrl ?? m.posterUrl) && <img {...imgSet(m.thumb, '100px', m.thumbUrl ?? m.posterUrl)} alt="" />}
              {m.type === 'video' && (
                <span className={p.play}>
                  <img src="/design/icons/play.svg" alt="" width={21.6667} height={27} />
                </span>
              )}
            </button>
          ))}
        </div>
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
          // Главное фото — LCP страницы товара: высокий приоритет загрузки, размер под ширину экрана (копии 320/640/1200)
          <img
            {...imgSet(cur.image, STAGE_SIZES, cur.url)}
            alt={i === 0 ? title : `${title}, фото ${i + 1}`}
            onClick={() => setZoom(true)}
            fetchPriority={i === 0 ? 'high' : 'auto'}
          />
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
