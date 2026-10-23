'use client';

import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import p from './profile.module.css';

type Req = { id: string; question: string; sharePhotos: boolean; status: 'open' | 'answered' | 'cancelled'; answer: string | null; createdAt: string; answeredAt: string | null };
const day = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/**
 * Консультация стилиста (ТЗ §8, §11). Анкету и капсулу стилист видит, пока вопрос открыт; фото —
 * только если отмечено «показать фото». После ответа доступ закрывается.
 */
export function Stylist({ quizCompleted, hasPhotos }: { quizCompleted: boolean; hasPhotos: boolean }) {
  const [items, setItems] = useState<Req[] | null>(null);
  const [question, setQuestion] = useState('');
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Req[]>('/me/stylist').then(setItems).catch(() => setItems([]));
  }, []);
  const run = async (fn: () => Promise<Req[]>) => {
    setError(null);
    try {
      setItems(await fn());
      return true;
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
      return false;
    }
  };
  const open = items?.find((r) => r.status === 'open');

  return (
    <div className={p.card}>
      <h2>Консультация стилиста</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {!quizCompleted ? (
        <p className={p.muted}>Пройдите анкету — стилист посмотрит её вместе с вашей капсулой.</p>
      ) : open ? (
        <>
          <p style={{ margin: '0 0 8px' }}>«{open.question}»</p>
          <p className={p.muted}>
            Отправлено {day(open.createdAt)}. Стилист видит вашу анкету и капсулу{open.sharePhotos ? ' и фото' : ''}, пока не ответит. Ответ придёт на почту.
          </p>
          <Button variant="ghost" onClick={() => run(() => api<Req[]>(`/me/stylist/${open.id}/cancel`, {}))}>
            Отменить вопрос
          </Button>
        </>
      ) : (
        <>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Например: какой цвет халата подойдёт к моему цветотипу?"
            aria-label="Вопрос стилисту"
            style={{ width: '100%', font: 'inherit', padding: 10, borderRadius: 10, border: '1px solid var(--c-border)', marginBottom: 8, background: 'var(--c-surface)', color: 'inherit' }}
          />
          <label className={p.consent}>
            <input type="checkbox" checked={share} disabled={!hasPhotos} onChange={(e) => setShare(e.target.checked)} />
            {hasPhotos ? 'Показать стилисту мои фото — только на время ответа' : 'Загрузите фото выше, чтобы показать их стилисту'}
          </label>
          <p className={p.muted}>Стилист увидит анкету и капсулу, но не ваши email и телефон. После ответа доступ закроется.</p>
          <Button
            disabled={question.trim().length < 10}
            onClick={async () => {
              if (await run(() => api<Req[]>('/me/stylist', { question, sharePhotos: share }))) {
                setQuestion('');
                setShare(false);
              }
            }}
          >
            Задать вопрос
          </Button>
        </>
      )}
      {items
        ?.filter((r) => r.status === 'answered')
        .map((r) => (
          <div key={r.id} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
            <p className={p.muted} style={{ margin: 0 }}>
              {day(r.answeredAt!)} · «{r.question}»
            </p>
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>{r.answer}</p>
          </div>
        ))}
    </div>
  );
}
