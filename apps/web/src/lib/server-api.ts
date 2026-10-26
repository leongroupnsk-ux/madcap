import 'server-only';
import { cookies } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Запрос к API из серверного компонента с cookie сессии пользователя. */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const sid = (await cookies()).get('sid')?.value;
  const res = await fetch(`${API}/api${path}`, { headers: sid ? { cookie: `sid=${sid}` } : {}, cache: 'no-store' }).catch(() => null);
  if (!res) return { status: 503, data: null };
  if (!res.ok) return { status: res.status, data: null };
  // Ответ null контроллер Nest отдаёт пустым телом (200, Content-Length: 0) — например, /me/capsule без капсулы.
  // res.json() на пустом теле падает «Unexpected end of JSON input» и роняет всю страницу (найдено e2e на /account).
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}
