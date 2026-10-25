'use client';

import { MEMBER_ROLE_LABEL } from '@aesculap/shared';
import { usePopover } from './Bell';
import { useSupplierLogout } from './Sidebar';
import s from './shell.module.css';

/** Меню аккаунта в шапке кабинета (кадр menu-partner): поставщик, email входа, роль участника, «Выйти». */
export function AccountMenu({ name, email, role }: { name: string; email: string; role: keyof typeof MEMBER_ROLE_LABEL }) {
  const { open, setOpen, box } = usePopover();
  const logout = useSupplierLogout();
  return (
    <div className={s.pop} ref={box}>
      <button type="button" className={s.menuBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" title={name}>
        <span>{name}</span>
        <img src="/design/icons/sup-chevron-down.svg" alt="" width={16} height={16} />
      </button>
      {open && (
        <div className={`${s.panel} ${s.menuPanel}`} role="menu" aria-label="Аккаунт">
          <div className={s.menuName}>{name}</div>
          <div className={s.menuEmail}>{email}</div>
          <div className={s.menuRole}>{MEMBER_ROLE_LABEL[role]}</div>
          <button type="button" role="menuitem" className={s.logout} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
