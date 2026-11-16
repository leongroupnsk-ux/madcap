// Форматирование без zod: эти функции нужны клиентским компонентам на каждой странице (шапка, карточки),
// и отдельный модуль не тянет в браузер схемы и zod (вместе с "sideEffects": false в package.json; docs/PERF.md).

export const toKopecks = (rub: number) => Math.round(rub * 100);
export const toRubles = (kop: number) => kop / 100;
export const formatRub = (kop: number) => `${(kop / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

/** Склонение по числу: plural(4, 'вещь', 'вещи', 'вещей') → «вещи». */
export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
