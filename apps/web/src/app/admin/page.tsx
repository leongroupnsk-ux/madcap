import { canAccess } from '@aesculap/shared';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { NAV } from '@/lib/admin-nav';

/** /admin — стартовая страница: владельцу и поддержке дашборд платформы, остальным — первый доступный раздел */
export default async function AdminPage() {
  const user = await getSessionUser();
  redirect(NAV.find((n) => canAccess(user?.staffRole, n.area))?.href ?? '/');
}
