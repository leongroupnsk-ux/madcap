'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Переключатель «Просить оставить отзыв после доставки» для профиля покупателя (GET/PUT /api/me/review-invites).
 * Рендерится рядом с согласиями в app/(shop)/account/Profile.tsx; className — класс строки согласия оттуда.
 */
export function ReviewInvitesToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ enabled: boolean }>('/me/review-invites').then((r) => setEnabled(r.enabled)).catch(() => setEnabled(null));
  }, []);
  if (enabled === null) return null;
  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={async (e) => {
          const next = e.target.checked;
          setEnabled(next);
          setEnabled((await api<{ enabled: boolean }>('/me/review-invites', { enabled: next }, 'PUT').catch(() => ({ enabled: !next }))).enabled);
        }}
      />
      <span>Просить оставить отзыв через неделю после доставки</span>
    </label>
  );
}
