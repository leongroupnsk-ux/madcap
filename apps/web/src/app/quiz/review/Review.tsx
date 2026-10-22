'use client';

import { BUDGETS, COLOR_TYPES, bodyTypeOf, colorTypeOf } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import s from '@/components/quiz/quiz.module.css';
import { useQuiz } from '@/components/quiz/useQuiz';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { Dictionaries } from '@/lib/types';

const age = (n?: number | null) => (n ? `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет'}` : null);

/** «Всё выглядит верно?» — проверка ответов перед созданием профиля (ТЗ §5.1). */
export function Review({ groups }: { groups: Dictionaries['specialtyGroups'] }) {
  const router = useRouter();
  const { data: d, authed, photos, ready } = useQuiz();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return <div className={s.wrap} />;
  const names = groups.flatMap((g) => g.specialties).filter((sp) => d.specialtyIds?.includes(sp.id)).map((sp) => sp.name);
  const ct = colorTypeOf(d.skinTone, d.hair);
  const cards: [string, string | null, number | null][] = [
    ['Имя', [d.name, d.gender === 'female' ? 'Женский' : d.gender === 'male' ? 'Мужской' : null, age(d.age)].filter(Boolean).join(' · ') || null, 1],
    ['Параметры', [d.heightCm && `${d.heightCm} см`, d.weightKg && `${d.weightKg} кг`].filter(Boolean).join(' · ') || null, 2],
    ['Размер', [d.sizeTop && `Верх: ${d.sizeTop}`, d.sizeBottom && `Низ: ${d.sizeBottom}`, d.sizeShoes && `Обувь: ${d.sizeShoes}`].filter(Boolean).join(' · ') || null, 2],
    ['Тип фигуры', bodyTypeOf(d.sizeTop, d.sizeBottom), null],
    ['Цветотип', ct ? COLOR_TYPES[ct].label : null, 3],
    ['Профессия', names.join(', ') || null, 4],
    ['Бюджет', BUDGETS.find((b) => b.id === d.budgetRange)?.label ?? null, 5],
    ['Фотографии', authed ? `${photos.length} фото` : 'после создания профиля', 6],
  ];

  const create = async () => {
    if (!authed) {
      router.push('/register?next=/quiz/review');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/me/profile', { complete: true }, 'PUT');
      router.push('/quiz/done');
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
      setBusy(false);
    }
  };

  return (
    <div className={s.wrap} style={{ width: 'min(720px, 100%)' }}>
      <div className="eyebrow">Ваши данные</div>
      <h1 className={s.title}>Всё выглядит верно?</h1>
      <p className={s.lead}>Проверьте профиль — любой блок можно изменить отдельно.</p>
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className={s.reviewGrid}>
        {cards.map(([label, value, step]) => (
          <div key={label} className={s.reviewCard}>
            <div>
              {label}
              {step && <Link href={`/quiz/${step}`}>Изменить</Link>}
            </div>
            {value ?? <span style={{ color: 'var(--c-text-faint)' }}>не указано</span>}
          </div>
        ))}
      </div>
      <div className={s.nav}>
        <Link href="/quiz/6" className={s.back}>
          ← Назад
        </Link>
        <Button onClick={create} disabled={busy}>
          {busy ? 'Создаём…' : authed ? 'Создать мой профиль →' : 'Создать аккаунт и профиль →'}
        </Button>
      </div>
      {!authed && <p className={s.lead} style={{ marginTop: 16 }}>Чтобы сохранить профиль и собрать капсулу, нужен аккаунт — ответы перенесём автоматически.</p>}
    </div>
  );
}
