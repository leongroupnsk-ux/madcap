import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Запрос к API из серверного компонента с cookie сессии пользователя. */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const sid = (await cookies()).get('sid')?.value;
  const h = await headers();
  // User-Agent браузера — для счётчика просмотров товара (роботы не считаются); адрес покупателя (его ставит Caddy) —
  // для лимитов на IP и того же счётчика: без него все запросы страниц приходят в API с адреса сайта
  const ua = h.get('user-agent')?.slice(0, 400);
  const ip = h.get('x-forwarded-for');
  const res = await fetch(`${API}/api${path}`, {
    headers: { ...(sid ? { cookie: `sid=${sid}` } : {}), ...(ua ? { 'X-Client-UA': ua } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) },
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return { status: 503, data: null };
  if (!res.ok) return { status: res.status, data: null };
  // Ответ null контроллер Nest отдаёт пустым телом (200, Content-Length: 0) — например, /me/capsule без капсулы.
  // res.json() на пустом теле падает «Unexpected end of JSON input» и роняет всю страницу (найдено e2e на /account).
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}

/** Ответы API, при которых страницы действительно нет: такого товара, раздела, заказа или запрос неверный. */
const MISSING = new Set([400, 403, 404, 410]);

/**
 * Данных для страницы нет: 404 — только если API так и ответил. Сбой API (5xx, недоступен, 429) — ошибка страницы
 * с кодом 500 и экраном «Не получилось загрузить» (app/(shop)/error.tsx). Раньше любой сбой становился 404: при
 * перегрузке или перезапуске API поисковик видел «страницы нет» и мог убрать её из выдачи (docs/LOAD.md).
 */
export function pageMissing(status: number): never {
  if (MISSING.has(status) || (status >= 200 && status < 300)) notFound();
  throw new Error(`API недоступен: ${status}`);
}
