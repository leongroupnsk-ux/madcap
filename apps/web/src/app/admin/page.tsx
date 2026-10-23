import { canAccess } from '@aesculap/shared';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { NAV } from '@/lib/admin-nav';
import { serverApi } from '@/lib/server-api';
import { Applications, type Application } from './Applications';

export const metadata = { title: 'Заявки поставщиков' };

export default async function AdminPage() {
  // Стартовая страница — первый доступный роли раздел
  const user = await getSessionUser();
  if (user && !canAccess(user.staffRole, 'suppliers')) redirect(NAV.find((n) => canAccess(user.staffRole, n.area))?.href ?? '/');
  const apps = (await serverApi<Application[]>('/admin/applications')).data ?? [];
  return <Applications initial={apps} />;
}
