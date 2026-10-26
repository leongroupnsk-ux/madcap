import type { Metadata } from 'next';
import { STAFF_ROLES, canAccess } from '@aesculap/shared';
import { NAV } from '@/lib/admin-nav';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import s from '@/components/supplier/cabinet.module.css';
import { BRAND } from '@/lib/brand';
import { getSessionUser } from '@/lib/session';

export const metadata: Metadata = { title: { default: 'Админка', template: '%s — админка' }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/admin');
  if (user.role !== 'admin') redirect('/');
  // Обязательная 2FA не включена — вся админка, кроме страницы её настройки, закрыта (сервер отвечает twofa_setup_required)
  const setupOnly = Boolean(user.twofaSetupRequired);
  if (setupOnly && (await headers()).get('x-pathname') !== '/admin/security') redirect('/admin/security');
  return (
    <div className={s.shell}>
      <aside className={s.side}>
        <Link href="/admin" className={s.brand}>
          {BRAND.mark}
          <span className={s.brandSub}>Админка</span>
        </Link>
        <nav className={s.nav}>
          {NAV.filter((n) => !setupOnly && canAccess(user.staffRole, n.area)).map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className={s.sideFoot}>
          {user.email}
          <div style={{ opacity: 0.7 }}>{STAFF_ROLES[user.staffRole ?? 'owner']}</div>
          <Link href="/admin/security" style={{ display: 'inline-block', marginTop: 6 }}>
            Профиль и безопасность
          </Link>
        </div>
      </aside>
      <div className={s.main}>
        <div className={s.content}>{children}</div>
      </div>
    </div>
  );
}
