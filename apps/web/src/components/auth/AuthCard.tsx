import type { ReactNode } from 'react';
import { BRAND } from '@/lib/brand';
import s from './auth.module.css';

export function AuthCard({ title, eyebrow = 'Личный кабинет', children }: { title: ReactNode; eyebrow?: string; children: ReactNode }) {
  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <div className={s.logo}>{BRAND.mark}</div>
        <div className={s.head}>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className={s.title}>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
