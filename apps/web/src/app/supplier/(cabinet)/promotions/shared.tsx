import s from '@/components/supplier/cabinet.module.css';

export type Promo = {
  id: string; name: string; description: string; badge: string; minDiscountPct: number; commissionBp: number;
  applyFrom: string; applyTo: string; startsAt: string; endsAt: string; onHomepage: boolean; newsletter: boolean; requirements: string;
  phase: 'scheduled' | 'applying' | 'waiting' | 'running' | 'finished'; acceptsApplications: boolean;
  stats: { products: number; pending: number; soldWeek: number };
};

export const day = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export function PhaseBadge({ p }: { p: Promo }) {
  const [cls, text] =
    p.phase === 'running'
      ? ['b_active', `Идёт до ${day(p.endsAt)}`]
      : p.phase === 'applying'
        ? ['b_pending', `Приём заявок до ${day(p.applyTo)}`]
        : p.phase === 'waiting'
          ? ['b_checked', `Старт ${day(p.startsAt)}`]
          : p.phase === 'scheduled'
            ? ['b_checked', `Заявки с ${day(p.applyFrom)}`]
            : ['b_draft', 'Завершена'];
  return <span className={`${s.badge} ${s[cls]}`} style={{ justifySelf: 'start' }}>{text}</span>;
}

/** Условия акции (ТЗ §7.7): мин. скидка, бейдж, главная, рассылка, льготная комиссия */
export function Conditions({ p, baseBp }: { p: Promo; baseBp: number }) {
  return (
    <ul className={s.muted} style={{ margin: '8px 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
      <li>Скидка от {p.minDiscountPct}%</li>
      <li>Бейдж «{p.badge}» на карточке</li>
      {p.onHomepage && <li>Раздел на главной</li>}
      {p.newsletter && <li>Рассылка покупателям</li>}
      <li>
        Комиссия {p.commissionBp / 100}% вместо {baseBp / 100}%
      </li>
      <li>
        Акция: {day(p.startsAt)} — {day(p.endsAt)}
      </li>
    </ul>
  );
}
