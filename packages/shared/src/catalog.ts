import { z } from 'zod';

/** Таблица размеров платформы по умолчанию (прототип, модалка «Таблица размеров»); бренд может задать свою. */
export const DEFAULT_SIZE_CHART = {
  clothes: {
    columns: ['Российский', 'Международный', 'Обхват груди, см', 'Обхват талии, см', 'Обхват бёдер, см'],
    rows: [
      ['42', 'XS', '86', '68', '92'],
      ['44', 'S', '88', '72', '96'],
      ['46', 'M', '92', '74', '98'],
      ['48', 'L', '96', '76', '100'],
      ['50', 'XL', '100', '80', '104'],
      ['52', 'XXL', '104', '84', '108'],
      ['54', 'XXXL', '108', '88', '112'],
    ],
  },
  shoes: {
    columns: ['Российский', 'EU', 'Длина стопы, см'],
    rows: [
      ['35', '36', '22,5'],
      ['36', '37', '23'],
      ['37', '38', '23,5'],
      ['38', '39', '24,5'],
      ['39', '40', '25'],
      ['40', '41', '26'],
      ['41', '42', '26,5'],
      ['42', '43', '27,5'],
      ['43', '44', '28'],
      ['44', '45', '29'],
    ],
  },
};
export type SizeChart = typeof DEFAULT_SIZE_CHART;

export const ContentStatus = { draft: 'draft', pending: 'pending', published: 'published', rejected: 'rejected' } as const;

export const articleSaveSchema = z.object({
  title: z.string().trim().min(3, 'Заголовок статьи').max(160),
  lead: z.string().trim().max(300).optional().default(''),
  coverKey: z.string().regex(/^public\/content\/[\w-]+\.webp$/).nullable().default(null),
  body: z.string().max(100_000).default(''),
  productIds: z.array(z.string().uuid()).max(30).default([]),
});
export type ArticleSaveInput = z.infer<typeof articleSaveSchema>;

export const collectionSaveSchema = z.object({
  title: z.string().trim().min(3, 'Название подборки').max(160),
  description: z.string().trim().max(1000).optional().default(''),
  coverKey: z.string().regex(/^public\/content\/[\w-]+\.webp$/).nullable().default(null),
  productIds: z.array(z.string().uuid()).max(60).default([]),
});
export type CollectionSaveInput = z.infer<typeof collectionSaveSchema>;
