import { z } from 'zod';

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

/** Отзыв покупателя: оценка 1–5, текст 10–2000 символов, посадка, до 3 фото (ключи из загрузки) */
export const reviewSaveSchema = z.object({
  rating: z.number().int().min(1, 'Поставьте оценку').max(5),
  fit: z.enum(REVIEW_FITS, { errorMap: () => ({ message: 'Отметьте, подошёл ли размер' }) }),
  text: z.string().trim().min(10, 'Напишите хотя бы 10 символов').max(2000, 'Не больше 2000 символов'),
  photos: z.array(z.string().max(200)).max(REVIEW_MAX_PHOTOS, `Не больше ${REVIEW_MAX_PHOTOS} фото`).default([]),
});
export type ReviewSaveInput = z.infer<typeof reviewSaveSchema>;

export const reviewCreateSchema = reviewSaveSchema.extend({ productId: z.string().uuid() });
export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;

/** Ответ продавца на отзыв — один, публикуется сразу */
export const reviewReplySchema = z.object({ text: z.string().trim().min(2, 'Напишите ответ').max(1000, 'Не больше 1000 символов') });

/** «Сообщить о поступлении»: гость указывает email и даёт согласие на его обработку */
export const restockSubscribeSchema = z.object({
  variantId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('Проверьте email').max(200).optional(),
  consent: z.boolean().optional(),
});
export type RestockSubscribeInput = z.infer<typeof restockSubscribeSchema>;

export const favoritesMergeSchema = z.object({ productIds: z.array(z.string().uuid()).max(200) });
