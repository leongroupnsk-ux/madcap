import { redirect } from 'next/navigation';
import s from '@/components/quiz/quiz.module.css';
import Link from 'next/link';
import { getSessionUser } from '@/lib/session';

export default async function QuizDonePage() {
  const user = await getSessionUser();
  if (!user) redirect('/quiz/review');
  return (
    <div className={s.done}>
      <div className={s.doneBox}>
        <div className={s.check96} aria-hidden>
          ✓
        </div>
        <div className={s.doneEyebrow}>Персональный профиль</div>
        <h1>Ваш персональный профиль готов</h1>
        <p>Мы учли ваши параметры, размер, стиль, цвета и бюджет. Теперь соберём капсулу специально для вас.</p>
        <Link href="/capsule" className={s.doneBtn}>
          Посмотреть капсулу →
        </Link>
      </div>
    </div>
  );
}
