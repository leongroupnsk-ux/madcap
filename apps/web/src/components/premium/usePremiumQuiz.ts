'use client';

import type { PremiumAnswers } from '@aesculap/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, isApiError } from '@/lib/api';

export type Photo = { id: string; angle: string | null; url: string };

const KEY = 'premium-quiz-v1';
const CAPSULE_KEY = 'premium-capsule-v1';

type Draft = { answers: PremiumAnswers; completed?: boolean };

function read<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим: ответы живут до закрытия вкладки */
  }
}

/** Выбор в капсуле гостя: текущий вариант и замены по вариантам (слот → вариант товара). */
export type CapsuleChoice = { variantNo: number; overrides: Record<string, Record<string, string>> };
export const readChoice = () => read<CapsuleChoice>(CAPSULE_KEY, { variantNo: 1, overrides: {} });
export const writeChoice = (c: CapsuleChoice) => write(CAPSULE_KEY, c);

/**
 * Состояние премиум-анкеты: гостю — черновик в браузере (анкету можно пройти без регистрации),
 * после входа — запись в API; черновик гостя переносится при первом входе, как в обычной анкете.
 */
export function usePremiumQuiz() {
  const [answers, setAnswers] = useState<PremiumAnswers>({});
  const [completed, setCompleted] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    const draft = read<Draft>(KEY, { answers: {} });
    api<{ answers: PremiumAnswers; completed: boolean }>('/premium/answers')
      .then(async (r) => {
        const fromDraft = Object.fromEntries(Object.entries(draft.answers).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));
        const merged = { ...r.answers, ...fromDraft };
        let done = r.completed;
        if (Object.keys(fromDraft).length) {
          const saved = await api<{ completed: boolean }>('/premium/answers', { ...merged, ...(draft.completed ? { complete: true } : {}) }, 'PUT').catch(() => null);
          done = saved?.completed ?? done;
          try {
            localStorage.removeItem(KEY);
          } catch {
            /* ignore */
          }
        }
        setAnswers(merged);
        setCompleted(done);
        // «Готово» — только после переноса черновика, иначе капсула успеет решить, что анкета не пройдена
        setAuthed(true);
        api<{ photos: Photo[] }>('/me/profile').then((p) => setPhotos(p.photos)).catch(() => undefined);
      })
      .catch((e) => {
        if (isApiError(e) && e.status === 401) {
          setAuthed(false);
          setAnswers(draft.answers);
          setCompleted(Boolean(draft.completed));
        }
      });
  }, []);

  const save = useCallback(
    async (patch: PremiumAnswers, complete = false) => {
      const next = { ...answers, ...patch };
      setAnswers(next);
      if (authed) {
        const r = await api<{ completed: boolean }>('/premium/answers', { ...patch, ...(complete ? { complete: true } : {}) }, 'PUT');
        setCompleted(r.completed);
      } else {
        write(KEY, { answers: next, completed: completed || complete });
        if (complete) setCompleted(true);
      }
    },
    [answers, authed, completed],
  );

  return { answers, save, completed, authed, photos, setPhotos, ready: authed !== null };
}
