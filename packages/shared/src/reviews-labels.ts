// Подписи и пределы отзывов без zod: их показывают клиентские компоненты страницы товара, и отдельный модуль
// (путь @aesculap/shared/reviews-labels) не тянет в браузер схемы и zod (docs/PERF.md, «Этап 3»).

/** «Размер подошёл» в отзыве */
export const REVIEW_FITS = ['small', 'true_to_size', 'large'] as const;
export type ReviewFit = (typeof REVIEW_FITS)[number];

export const REVIEW_FIT_LABEL: Record<ReviewFit, string> = {
  small: 'Меньше',
  true_to_size: 'В размер',
  large: 'Больше',
};

/** Сводка «Размер: в основном …» на странице товара */
export const REVIEW_FIT_SUMMARY: Record<ReviewFit, string> = {
  small: 'в основном маломерит',
  true_to_size: 'в основном в размер',
  large: 'в основном большемерит',
};

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: 'На модерации',
  approved: 'Опубликован',
  rejected: 'Отклонён',
};

export const REVIEW_MAX_PHOTOS = 3;
