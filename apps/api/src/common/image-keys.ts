/**
 * Ключи и наборы размеров фото для витрины (srcset).
 *
 * Для каждого WebP-исходника `…/<uuid>.webp` делаются копии по ширине `…/<uuid>_w320.v1.webp`, `_w640.v1.webp`, `_w1200.v1.webp`
 * (без кадрирования, без увеличения). Исходник фото товара — оригинал (галерея), для карточек — превью `_thumb.webp`
 * (у него своё кадрирование под карточку), от превью делается только `_thumb_w320.v1.webp`.
 *
 * Ключи неизменяемые: исходник назван случайным uuid и не перезаписывается, а версия `v1` в имени копии меняется при смене
 * алгоритма (размеры, качество) — тогда старые копии в кэшах браузеров и CDN просто перестают запрашиваться.
 * Поэтому /api/files отдаёт их с `Cache-Control: immutable` на год.
 */
export const THUMBS_VERSION = 1;
/** Ширины копий оригинала: телефон 1×, телефон 2× и десктоп, большое фото товара */
export const IMAGE_WIDTHS = [320, 640, 1200] as const;
/** Ширины копий превью карточки (само превью — 600–640 px — идёт в srcset как крупный вариант) */
export const CARD_WIDTHS = [320] as const;
/** Номинальная ширина превью `_thumb.webp`: 600 у загруженных поставщиком, 640 у демо */
export const THUMB_WIDTH = 640;

export const thumbOf = (key: string) => key.replace(/\.webp$/, '_thumb.webp');
export const variantKey = (key: string, width: number) => key.replace(/\.webp$/, `_w${width}.v${THUMBS_VERSION}.webp`);

const VARIANT = new RegExp(`^(public/[\\w./-]+?)_w(\\d+)\\.v${THUMBS_VERSION}\\.webp$`);

/** Разбор ключа копии: исходник и ширина; null — не копия или ширина не из списка */
export function parseVariant(key: string): { source: string; width: number } | null {
  const m = VARIANT.exec(key);
  if (!m) return null;
  const width = Number(m[2]);
  const source = `${m[1]}.webp`;
  // Копия копии не делается: иначе цепочкой запросов можно было бы плодить файлы без конца
  if (VARIANT.test(source) || /_w\d+\.v\d+_/.test(source)) return null;
  const allowed: readonly number[] = source.endsWith('_thumb.webp') ? CARD_WIDTHS : IMAGE_WIDTHS;
  return allowed.includes(width) ? { source, width } : null;
}

/** Все копии, которые должны быть у исходника фото товара (оригинал + превью) */
export const photoVariantKeys = (key: string) => [...IMAGE_WIDTHS.map((w) => variantKey(key, w)), ...CARD_WIDTHS.map((w) => variantKey(thumbOf(key), w))];

/** Картинка для витрины: src — запасной вариант среднего размера, srcSet — все размеры; width/height — пропорции исходника, если известны */
export type ImageSet = { src: string; srcSet: string; width: number | null; height: number | null };
