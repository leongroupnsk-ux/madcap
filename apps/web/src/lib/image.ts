/**
 * Фото витрины набором размеров (API: StorageService.imageSet / cardSet). Копии по ширине 320/640/1200 —
 * WebP с неизменяемыми ключами; браузер выбирает по `sizes` — реальной ширине места на странице.
 */
export type ImageSet = { src: string; srcSet: string; width: number | null; height: number | null };

/** Атрибуты <img> для набора; без набора — просто запасной src (старые ответы API, видео) */
export function imgSet(set: ImageSet | null | undefined, sizes: string, fallback?: string | null) {
  if (!set) return fallback ? { src: fallback } : null;
  return { src: set.src, ...(set.srcSet ? { srcSet: set.srcSet, sizes } : {}) };
}

/**
 * Ширина карточки товара в сетке (shop.module.css .grid): контейнер 1320 с полями 32 (16 до 768 px), 5 колонок с зазором 16,
 * 4 — до 1100 px, 3 — до 900 px, 2 с зазором 10 — до 640 px.
 */
export const CARD_SIZES =
  '(max-width: 640px) calc(50vw - 21px), (max-width: 767px) calc(33.3vw - 22px), (max-width: 900px) calc(33.3vw - 32px), (max-width: 1100px) calc(25vw - 28px), (max-width: 1384px) calc(20vw - 26px), 239px';

/** Обложка в ленте журнала (journal.module.css .grid): 3 колонки, 2 — до 900 px, 1 — до 640 px; внутренний отступ карточки 12 */
export const JOURNAL_SIZES = '(max-width: 640px) calc(100vw - 56px), (max-width: 767px) calc(50vw - 48px), (max-width: 900px) calc(50vw - 64px), (max-width: 1384px) calc(33.3vw - 56px), 384px';

/** Обложка статьи и подборки в шапке (journal.module.css .articleCover, до 930 px) */
export const ARTICLE_COVER_SIZES = '(max-width: 767px) calc(100vw - 32px), (max-width: 994px) calc(100vw - 64px), 930px';

/** Большое фото товара (product.module.css .stage): на телефоне — во всю ширину, но не больше 560; на десктопе — колонка 663 из 1224 минус превью */
export const STAGE_SIZES = '(max-width: 900px) min(calc(100vw - 32px), 560px), (max-width: 1384px) calc(54vw - 164px), 551px';
