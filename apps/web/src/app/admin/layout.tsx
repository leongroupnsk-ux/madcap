import type { Metadata } from 'next';
import { STAFF_ROLES, canAccess } from '@aesculap/shared';
import { NAV } from '@/lib/admin-nav';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import sh from '@/components/admin/shell.module.css';
import { getSessionUser } from '@/lib/session';
import { AdminNav, AdminSection } from './AdminNav';

export const metadata: Metadata = { title: { default: 'Админка', template: '%s — админка' }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/admin');
  if (user.role !== 'admin') redirect('/');
  // Обязательная 2FA не включена — вся админка, кроме страницы её настройки, закрыта (сервер отвечает twofa_setup_required)
  const setupOnly = Boolean(user.twofaSetupRequired);
  if (setupOnly && (await headers()).get('x-pathname') !== '/admin/security') redirect('/admin/security');
  // Счётчик непрочитанных у «Заявки премиум» AdminNav запрашивает сам (GET /admin/premium/unread)
  const items = NAV.filter((n) => !setupOnly && canAccess(user.staffRole, n.area)).map(({ href, label }) => ({ href, label }));
  return (
    <div className={sh.shell}>
      <AdminNav items={items} />
      <div className={sh.main}>
        {/* Шапка: текущий раздел и сотрудник (ссылка — на «Профиль и безопасность») */}
        <header className={sh.top}>
          <AdminSection items={items} />
          <Link href="/admin/security" className={sh.who} title={`${user.email} · ${STAFF_ROLES[user.staffRole ?? 'owner']}`}>
            <span className={sh.whoEmail}>{user.email}</span>
            <span className={sh.whoRole}>{STAFF_ROLES[user.staffRole ?? 'owner']}</span>
          </Link>
        </header>
        <main className={sh.content}>{children}</main>
      </div>
    </div>
  );
}
