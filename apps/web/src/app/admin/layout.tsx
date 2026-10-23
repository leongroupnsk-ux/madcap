import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import s from '@/components/supplier/cabinet.module.css';
import { BRAND } from '@/lib/brand';
import { getSessionUser } from '@/lib/session';

export const metadata: Metadata = { title: { default: 'Админка', template: '%s — админка' }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/admin');
  if (user.role !== 'admin') redirect('/');
  return (
    <div className={s.shell}>
      <aside className={s.side}>
        <Link href="/admin" className={s.brand}>
          {BRAND.mark}
          <span className={s.brandSub}>Админка</span>
        </Link>
        <nav className={s.nav}>
          <Link href="/admin">Заявки поставщиков</Link>
          <Link href="/admin/moderation">Модерация товаров</Link>
          <Link href="/admin/content">Модерация контента</Link>
          <Link href="/admin/promotions">Акции</Link>
          <Link href="/admin/payouts">Выплаты поставщиков</Link>
          <Link href="/admin/users">Пользователи</Link>
        </nav>
        <div className={s.sideFoot}>{user.email}</div>
      </aside>
      <div className={s.main}>
        <div className={s.content}>{children}</div>
      </div>
    </div>
  );
}
