import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/premium/premium.module.css';

export const metadata: Metadata = { title: 'Профиль готов', robots: { index: false } };

/** Успех анкеты (кадр .Premium-Quiz-success) */
export default function PremiumQuizDone() {
  return (
    <div className={s.success}>
      <div className={s.successInner}>
        <div className={s.check} aria-hidden>
          ✓
        </div>
        <span className={s.eyebrow}>ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ</span>
        <h1 className={s.title}>Ваш персональный профиль готов</h1>
        <p className={s.lead}>Мы учли ваши параметры, размер, стиль, цвета и бюджет. Теперь соберём капсулу специально для вас.</p>
        <Link href="/premium/capsule" className={s.btnSilver}>
          подобрать капсулу
        </Link>
      </div>
    </div>
  );
}
