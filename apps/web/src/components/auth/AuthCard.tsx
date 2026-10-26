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
        <Link href="/" className={s.logo} aria-label="aesculap — на главную">
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
export function RoleSwitch({ active = 'buyer' }: { active?: 'buyer' | 'supplier' }) {
  const items = [
    { key: 'buyer', href: '/login', label: 'Покупатель' },
    { key: 'supplier', href: '/supplier/login', label: 'Поставщик' },
  ] as const;
  return (
    <nav className={s.roles} aria-label="Тип входа">
      <span className={s.rolesLabel}>Вход для:</span>
      {items.map((i) =>
        i.key === active ? (
          <span key={i.key} className={`${s.role} ${s.roleActive}`} aria-current="page">
            {i.label}
          </span>
        ) : (
          <Link key={i.key} href={i.href} className={s.role}>
            {i.label}
          </Link>
        ),
      )}
    </nav>
  );
}
