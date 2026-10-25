import s from '@/components/premium/premium.module.css';

/** Премиум-раздел: своя тёмная тема, своя шапка и подвал — без основной шапки сайта (кадры .Premium*). */
export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  return <div className={s.root}>{children}</div>;
}
