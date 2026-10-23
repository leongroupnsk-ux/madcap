import { z } from 'zod';
import type { ConsentType } from './enums.js';

/** Юридические страницы сайта (ТЗ §8 «Витрина», §11) */
export const LEGAL_DOCS = {
  privacy: 'Политика обработки персональных данных',
  offer: 'Публичная оферта для покупателей',
  delivery: 'Доставка и возврат',
  photos: 'Согласие на обработку фото',
  suppliers: 'Условия для поставщиков',
} as const;
export type LegalSlug = keyof typeof LEGAL_DOCS;

/** Какой документ подтверждает согласие — его версия пишется вместе с согласием */
export const CONSENT_DOC: Record<ConsentType, LegalSlug> = { pdn: 'privacy', offer: 'offer', photos: 'photos', marketing: 'privacy' };

/** Реквизиты оператора в тексте — подставляются из окружения сервера при показе */
export const OPERATOR_TOKENS = ['OPERATOR_NAME', 'OPERATOR_INN', 'OPERATOR_OGRN', 'OPERATOR_ADDRESS', 'OPERATOR_EMAIL'] as const;

export const legalPublishSchema = z.object({
  title: z.string().trim().min(5, 'Заголовок — от 5 символов').max(160),
  html: z.string().max(200_000),
  note: z.string().trim().max(300).default(''),
});
export type LegalPublish = z.infer<typeof legalPublishSchema>;
