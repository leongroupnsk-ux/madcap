/** Проверка контрольных цифр ИНН: 10 знаков — юрлицо, 12 — ИП/физлицо. */
export function isValidInn(value: string): boolean {
  const d = value.replace(/\s/g, '');
  if (!/^\d{10}$|^\d{12}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const check = (coef: number[]) => (coef.reduce((s, c, i) => s + c * n[i], 0) % 11) % 10;
  if (n.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[9];
  return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[11];
}
