import { redirect } from 'next/navigation';
import s from '@/components/quiz/quiz.module.css';
import { ButtonLink } from '@/components/ui';
import { getSessionUser } from '@/lib/session';

export default async function QuizDonePage() {
  const user = await getSessionUser();
  if (!user) redirect('/quiz/review');
  return (
    <div className={s.done}>
      <div>
        <div className={s.check64}>✓</div>
        <div className="eyebrow" style={{ color: 'rgba(255,255,255,.6)' }}>
          Персональный профиль
        </div>
        <h1>Ваш персональный профиль готов</h1>
        <p>Мы учли ваши параметры, размер, стиль, цвета и бюджет. Теперь соберём капсулу специально для вас.</p>
        <ButtonLink href="/capsule" variant="soft">
          Посмотреть капсулу →
        </ButtonLink>
      </div>
    </div>
  );
}
