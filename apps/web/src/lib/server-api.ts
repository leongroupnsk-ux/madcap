import 'server-only';
import { cookies, headers } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Запрос к API из серверного компонента с cookie сессии пользователя. */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const sid = (await cookies()).get('sid')?.value;
  // User-Agent браузера — для счётчика просмотров товара (роботы не считаются); других данных о клиенте не передаём
  const ua = (await headers()).get('user-agent')?.slice(0, 400);
  const res = await fetch(`${API}/api${path}`, { headers: { ...(sid ? { cookie: `sid=${sid}` } : {}), ...(ua ? { 'X-Client-UA': ua } : {}) }, cache: 'no-store' }).catch(() => null);
  if (!res) return { status: 503, data: null };
  if (!res.ok) return { status: res.status, data: null };
  // Ответ null контроллер Nest отдаёт пустым телом (200, Content-Length: 0) — например, /me/capsule без капсулы.
  // res.json() на пустом теле падает «Unexpected end of JSON input» и роняет всю страницу (найдено e2e на /account).
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}
