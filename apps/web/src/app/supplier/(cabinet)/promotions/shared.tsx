import s from '@/components/supplier/cabinet.module.css';

export type Promo = {
  id: string; name: string; description: string; badge: string; minDiscountPct: number; commissionBp: number;
  applyFrom: string; applyTo: string; startsAt: string; endsAt: string; onHomepage: boolean; newsletter: boolean; requirements: string;
  phase: 'scheduled' | 'applying' | 'waiting' | 'running' | 'finished'; acceptsApplications: boolean;
  stats: { products: number; pending: number; soldWeek: number };
};

export const day = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const short = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

/** Фаза акции — пилюля в карточке (на тёмной карточке — полупрозрачная белая, как в макете) */
export function PhaseBadge({ p, dark }: { p: Promo; dark?: boolean }) {
  const [cls, text] =
    p.phase === 'running'
      ? ['b_active', `идёт · до ${short(p.endsAt)}`]
      : p.phase === 'applying'
        ? ['b_draft', `приём заявок · до ${short(p.applyTo)}`]
        : p.phase === 'waiting'
          ? ['b_draft', `старт ${short(p.startsAt)}`]
          : p.phase === 'scheduled'
            ? ['b_draft', `заявки с ${short(p.applyFrom)}`]
            : ['b_draft', 'завершена'];
  return <span className={`${s.promoBadge} ${dark ? s.promoBadgeDark : s[cls]}`}>{text}</span>;
}

/** Условия акции одной фразой (ТЗ §7.7): мин. скидка, бейдж, главная, рассылка, льготная комиссия */
export function conditionsText(p: Promo, baseBp: number) {
  const extras = [`бейдж «${p.badge}» в каталоге`, p.onHomepage && 'раздел на главной', p.newsletter && 'рассылка'].filter(Boolean).join(', ');
  const desc = p.description ? `${p.description.replace(/\.?\s*$/, '.')} ` : '';
  return `${desc}Скидка от ${p.minDiscountPct}%. ${extras[0].toUpperCase()}${extras.slice(1)}. Комиссия на время акции — ${p.commissionBp / 100}% вместо ${baseBp / 100}%. Акция: ${day(p.startsAt)} — ${day(p.endsAt)}.`;
}
