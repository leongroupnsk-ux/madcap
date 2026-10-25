'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import s from '@/components/auth/auth.module.css';
import { AuthCard } from '@/components/auth/AuthCard';
import { Alert, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

/** Подтверждение email — в макете не нарисовано, оформлено в стиле кадров .Auth. */
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

  if (state === 'pending') return <AuthCard title="Подтверждение email" lead="Проверяем ссылку…">{null}</AuthCard>;

  if (state === 'error')
    return (
      <AuthCard title="Ссылка не сработала">
        <div className={s.sent}>
          <Alert tone="error">{message}</Alert>
          <p className={s.status}>
            Новую ссылку можно отправить из <Link href="/account" className={s.forgot}>профиля</Link>.
          </p>
          <Link href="/" className={s.link}>
            ← На главную
          </Link>
        </div>
      </AuthCard>
    );

  return (
    <AuthCard title="Email подтверждён" lead="Спасибо! Теперь можно подобрать капсулу — анкета займёт около 5 минут.">
      <div className={`${s.sent} ${s.sentWide}`}>
        <ButtonLink href="/quiz/1" variant="accent">
          Подобрать капсулу
        </ButtonLink>
        <Link href="/account" className={s.link}>
          Перейти в профиль
        </Link>
      </div>
    </AuthCard>
  );
}
