import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountMenu } from '@/components/supplier/AccountMenu';
import { Bell } from '@/components/supplier/Bell';
import c from '@/components/supplier/cabinet.module.css';
import s from '@/components/supplier/shell.module.css';
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
        {/* Единая шапка кабинета (ТЗ §12 п.11): статус выплат, уведомления, меню аккаунта */}
        <header className={s.top}>
          {pay === 'active' ? (
            <span className={s.pay}>
              <img src="/design/icons/sup-check.svg" alt="" width={14} height={14} />
              <span>Выплаты подключены</span>
            </span>
          ) : (
            <Link href="/supplier/payouts" className={`${s.pay} ${s.payWarn}`}>
              <span>{pay === 'in_review' ? 'Реквизиты на проверке ЮKassa — товары скрыты с витрины' : 'Выплаты не подключены — товары не появятся на витрине'}</span>
            </Link>
          )}
          <div className={s.tools}>
            <Bell />
            <AccountMenu name={me.supplier.legalName} email={me.user.email} role={me.role} />
          </div>
        </header>
        <main className={`${s.content} ${c.sup}`}>{children}</main>
      </div>
    </div>
  );
}
