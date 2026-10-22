import 'server-only';
import { cookies } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Запрос к API из серверного компонента с cookie сессии пользователя. */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const sid = (await cookies()).get('sid')?.value;
  const res = await fetch(`${API}/api${path}`, { headers: sid ? { cookie: `sid=${sid}` } : {}, cache: 'no-store' }).catch(() => null);
  if (!res) return { status: 503, data: null };
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}
