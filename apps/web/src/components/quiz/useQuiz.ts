'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, isApiError } from '@/lib/api';

export type QuizData = {
  gender?: 'female' | 'male' | null;
  name?: string | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  sizeTop?: string | null;
  sizeBottom?: string | null;
  sizeShoes?: string | null;
  skinTone?: 'warm' | 'cold' | null;
  hair?: 'light' | 'dark' | null;
  eyes?: 'light' | 'dark' | null;
  specialtyIds?: string[];
  budgetRange?: string | null;
};
export type Photo = { id: string; angle: string | null; url: string };

const KEY = 'quiz-draft-v1';
const FIELDS: (keyof QuizData)[] = ['gender', 'name', 'age', 'heightCm', 'weightKg', 'sizeTop', 'sizeBottom', 'sizeShoes', 'skinTone', 'hair', 'eyes', 'specialtyIds', 'budgetRange'];

const readDraft = (): QuizData => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
export const clearDraft = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Состояние анкеты (ТЗ §5.1): гостю — черновик в браузере, после входа — профиль в API,
 * каждый шаг сохраняется сразу. Черновик гостя переносится в профиль при первом входе.
 */
export function useQuiz() {
  const [data, setData] = useState<QuizData>({});
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const draft = readDraft();
    api<QuizData & { photos: Photo[]; quizCompleted: boolean }>('/me/profile')
      .then(async (p) => {
        setAuthed(true);
        const fromServer = Object.fromEntries(FIELDS.map((k) => [k, p[k]])) as QuizData;
        // Ответы гостя важнее пустых полей профиля.
        const merged = { ...fromServer, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) };
        if (Object.keys(draft).length) {
          await api('/me/profile', merged, 'PUT').catch(() => undefined);
          clearDraft();
        }
        setData(merged);
        setPhotos(p.photos);
        setCompleted(p.quizCompleted);
      })
      .catch((e) => {
        if (isApiError(e) && e.status === 401) {
          setAuthed(false);
          setData(draft);
        }
      });
  }, []);

  const save = useCallback(
    async (patch: QuizData) => {
      const next = { ...data, ...patch };
      setData(next);
      if (authed) await api('/me/profile', patch, 'PUT');
      else
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* приватный режим: ответы живут до закрытия вкладки */
        }
    },
    [data, authed],
  );

  return { data, setData, save, authed, photos, setPhotos, completed, ready: authed !== null };
}
