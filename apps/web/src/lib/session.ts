import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';

export type SessionUser = {
  id: string;
  email: string;
  phone?: string | null;
  staffRole?: 'owner' | 'moderator' | 'editor' | 'support' | 'stylist' | null;
  role: 'buyer' | 'supplier_staff' | 'admin';
  emailVerified: boolean;
  hasCapsule?: boolean;
  totpEnabled?: boolean;
  /** Сотруднику обязательна 2FA, а она не включена — админка закрыта до настройки (/admin/security) */
  twofaSetupRequired?: boolean;
};

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Текущий пользователь на сервере: cookie сессии пробрасывается в API. Один запрос на рендер (шапка, лэйаут, страница). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const sid = (await cookies()).get('sid')?.value;
  if (!sid) return null;
  try {
    const res = await fetch(`${API}/api/auth/me`, { headers: { cookie: `sid=${sid}` }, cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { user: SessionUser }).user;
  } catch {
    return null;
  }
});
