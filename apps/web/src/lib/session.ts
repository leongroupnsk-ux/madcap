import 'server-only';
import { cookies } from 'next/headers';

export type SessionUser = { id: string; email: string; role: 'buyer' | 'supplier_staff' | 'admin'; emailVerified: boolean; hasCapsule?: boolean };

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Текущий пользователь на сервере: cookie сессии пробрасывается в API. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sid = (await cookies()).get('sid')?.value;
  if (!sid) return null;
  try {
    const res = await fetch(`${API}/api/auth/me`, { headers: { cookie: `sid=${sid}` }, cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { user: SessionUser }).user;
  } catch {
    return null;
  }
}
