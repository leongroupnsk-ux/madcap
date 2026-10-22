'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return; // ссылка одноразовая: не отправлять дважды в StrictMode
    sent.current = true;
    api('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((e) => {
        setMessage(isApiError(e) ? e.message : 'Нет связи с сервером.');
        setState('error');
      });
  }, [token]);

  if (state === 'pending') return <p>Проверяем ссылку…</p>;
  if (state === 'error')
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Alert tone="error">{message}</Alert>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)' }}>
          Новую ссылку можно отправить из <Link href="/account">профиля</Link>.
        </p>
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Alert tone="success">Email подтверждён.</Alert>
      <ButtonLink href="/quiz/1" variant="accent">
        Подобрать капсулу
      </ButtonLink>
    </div>
  );
}
