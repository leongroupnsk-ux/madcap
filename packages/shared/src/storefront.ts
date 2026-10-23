import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

/** Витрина (ТЗ §8): главный блок, премиум-баннер, «Хиты недели», «Капсула недели» */
export const storefrontSchema = z.object({
  hero: z.object({
    eyebrow: text(60),
    title: text(120).min(5, 'Заголовок — от 5 символов'),
    /** Слово заголовка, выделенное курсивом */
    accent: text(40),
    text: text(300),
    cta: text(40).min(2),
  }),
  premium: z.object({ title: text(80).min(3), text: text(240), cta: text(40).min(2) }),
  /** Пусто — хиты по продажам за неделю; иначе закреплённые товары по порядку */
  hitsProductIds: z.array(z.string().uuid()).max(15),
  capsuleOfWeek: z.object({ title: text(80), text: text(240), productIds: z.array(z.string().uuid()).max(6) }),
});
export type StorefrontSettings = z.infer<typeof storefrontSchema>;

export const DEFAULT_STOREFRONT: StorefrontSettings = {
  hero: {
    eyebrow: 'Персональный подбор',
    title: 'Рабочая капсула под Вашу специальность',
    accent: 'Вашу',
    text: 'Анкета за 5 минут: специальность, размеры и рост, дресс-код клиники и бюджет. Соберём комплект формы из 5 вещей.',
    cta: 'Подобрать капсулу',
  },
  premium: { title: 'Больше, чем униформа', text: 'Продуманный дизайн, исключительный комфорт. Создано для тех, кто меняет мир к лучшему.', cta: 'Премиум коллекция' },
  hitsProductIds: [],
  capsuleOfWeek: { title: '', text: '', productIds: [] },
};
