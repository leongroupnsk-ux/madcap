import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell } from '@/components/supplier/Bell';
import s from '@/components/supplier/cabinet.module.css';
import { Sidebar } from '@/components/supplier/Sidebar';
import { requireSupplier } from '@/lib/supplier-session';

export const metadata: Metadata = { title: { default: 'Кабинет поставщика', template: '%s — кабинет поставщика' }, robots: { index: false } };

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const me = await requireSupplier();
  if (!me)
    return (
      <div className="container" style={{ padding: 64 }}>
        <h1 style={{ fontSize: 32 }}>Нет доступа к кабинету поставщика</h1>
        <p>
          Этот аккаунт не привязан к поставщику. <Link href="/supplier/apply">Оставить заявку на подключение</Link> или{' '}
          <Link href="/supplier/login">войти под аккаунтом поставщика</Link>.
        </p>
      </div>
    );
  const pay = me.supplier.payoutStatus;
  return (
    <div className={s.shell}>
      <Sidebar role={me.role} />
      <div className={s.main}>
        <div className={s.top}>
          {pay === 'active' ? (
            <span className={s.payOk}>✓ Выплаты подключены</span>
          ) : (
            <Link href="/supplier/payouts" className={s.payWarn}>
              {pay === 'in_review' ? 'Реквизиты на проверке ЮKassa — товары скрыты с витрины' : 'Выплаты не подключены — товары не появятся на витрине'}
            </Link>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Bell />
            <span className={s.who} title={me.user.email}>
              {me.supplier.legalName}
            </span>
          </span>
        </div>
        <div className={s.content}>{children}</div>
      </div>
    </div>
  );
}
