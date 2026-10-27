'use client';

import { loadScript } from './load-script';

/**
 * Яндекс Метрика. Счётчик подключается только с номером из API (METRIKA_ID) и только после согласия
 * на аналитические cookie (MetrikaCounter). Вебвизор выключен (ПДн), карта кликов, внешние ссылки и точный показатель
 * отказов — включены. Хиты страниц шлём сами (defer: true) — так считаются и переходы внутри SPA.
 */
const TAG = 'https://mc.yandex.ru/metrika/tag.js';

/** Цели в Метрике: идентификаторы нужно завести в интерфейсе счётчика как «JavaScript-событие» */
export const GOALS = {
  quizDone: 'quiz_done',
  capsuleToCart: 'capsule_to_cart',
  orderPlaced: 'order_placed',
  premiumRequest: 'premium_request',
} as const;
export type Goal = (typeof GOALS)[keyof typeof GOALS];

type Ym = ((id: number, method: string, ...args: unknown[]) => void) & { a?: unknown[]; l?: number };
declare global {
  interface Window {
    ym?: Ym;
  }
}

let counterId: number | null = null;
let loaded = false;
let starting: Promise<void> | null = null;

/** Загрузить и инициализировать счётчик (один раз на вкладку) */
export function startMetrika(id: number): Promise<void> {
  if (starting) return starting;
  // Очередь вызовов до загрузки tag.js — как в официальном коде счётчика
  window.ym ??= Object.assign((...args: unknown[]) => void (window.ym!.a ??= []).push(args), { l: Date.now() }) as Ym;
  window.ym(id, 'init', { defer: true, clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  starting = loadScript(TAG).then(
    () => {
      counterId = id;
      loaded = true;
    },
    () => {
      // Блокировщик рекламы или сеть — сайт работает без аналитики; следующий вызов попробует снова
      starting = null;
    },
  );
  return starting;
}

export const metrikaLoaded = () => loaded && counterId !== null && typeof window.ym === 'function';

/** Просмотр страницы (первый и каждый переход внутри сайта) */
export function metrikaHit(url: string, referer?: string) {
  if (!metrikaLoaded()) return;
  window.ym!(counterId!, 'hit', url, referer ? { referer } : {});
}

/**
 * Достижение цели — только если счётчик загружен (без согласия или без ключа — ничего не делает).
 * Промис ждёт отправки (не дольше 400 мс): перед переходом на другую страницу цель не теряется.
 */
export function reachGoal(goal: Goal): Promise<void> {
  if (!metrikaLoaded()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 400);
    try {
      window.ym!(counterId!, 'reachGoal', goal, undefined, () => {
        clearTimeout(t);
        resolve();
      });
    } catch {
      clearTimeout(t);
      resolve();
    }
  });
}
