import Link from 'next/link';
import type { ReactNode } from 'react';
import { BRAND } from '@/lib/brand';
import s from './auth.module.css';

/** Карточка входа/регистрации по кадрам .Auth* макета: логотип, надзаголовок, заголовок Prata, подводка. */
export function AuthCard({
  title,
  eyebrow = 'Личный кабинет',
  lead,
  above,
  children,
}: {
  title: ReactNode;
  eyebrow?: string;
  lead?: ReactNode;
  /** Блок над карточкой (переключатель «Покупатель / Поставщик» на странице входа) */
  above?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={s.wrap}>
      {above}
      <div className={s.card}>
        <Link href="/" className={s.logo} aria-label="На главную">
          {BRAND.mark.replace(/\.$/, '')}
          <span className={s.logoDot}>.</span>
        </Link>
        <div className={`eyebrow ${s.eyebrow}`}>{eyebrow}</div>
        <h1 className={s.title}>{title}</h1>
        {lead && <p className={s.lead}>{lead}</p>}
        {children}
      </div>
    </div>
  );
}

/** Переключатель ролей над формой входа (в макете — пара пилюль «Покупатель / Поставщик»). */
export function RoleSwitch() {
  return (
    <nav className={s.roles} aria-label="Тип входа">
      <span className={s.rolesLabel}>Вход для:</span>
      <span className={`${s.role} ${s.roleActive}`} aria-current="page">
        Покупатель
      </span>
      <Link href="/supplier/login" className={s.role}>
        Поставщик
      </Link>
    </nav>
  );
}
