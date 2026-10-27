import { BADGE_LABELS } from '@/components/supplier/Badge';
import s from './admin.module.css';

/** Пилюля статуса в админке — те же подписи и цвета, что в кабинете поставщика. */
export function Badge({ status, children }: { status: string; children?: React.ReactNode }) {
  return <span className={`${s.badge} ${s[`b_${status}`] ?? ''}`}>{children ?? BADGE_LABELS[status] ?? status}</span>;
}
