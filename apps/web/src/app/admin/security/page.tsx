import { STAFF_ROLES } from '@aesculap/shared';
import { redirect } from 'next/navigation';
import s from '@/components/supplier/cabinet.module.css';
import { getSessionUser } from '@/lib/session';
import { AdminSecurity } from './AdminSecurity';

export const metadata = { title: 'Профиль и безопасность' };

/** Профиль сотрудника админки: роль и двухфакторная защита (обязательна для ролей из настроек безопасности). */
export default async function AdminSecurityPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/admin/security');
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Профиль и безопасность</h1>
          <p className={s.lead}>
            {user.email} · {STAFF_ROLES[user.staffRole ?? 'owner']}
          </p>
        </div>
      </div>
      <AdminSecurity enabled={Boolean(user.totpEnabled)} setupRequired={Boolean(user.twofaSetupRequired)} />
    </>
  );
}
