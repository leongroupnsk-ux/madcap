'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import s from '@/components/auth/auth.module.css';
import { AuthCard } from '@/components/auth/AuthCard';
import { Alert, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Result = { ok: true; alreadyOff: boolean; email: string | null };

/** Отписка от приглашений оставить отзыв. Запрос — из браузера, а не при открытии ссылки: почтовые сканеры не отпишут человека. */
export function ReviewInvitesUnsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState(token ? '' : 'В ссылке нет кода отписки.');
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api<Result>('/review-invites/unsubscribe', { token })
      .then((r) => {
        setResult(r);
        setState('ok');
      })
      .catch((e) => {
        setMessage(isApiError(e) ? e.message : 'Нет связи с сервером.');
        setState('error');
      });
  }, [token]);

  if (state === 'pending') return <AuthCard eyebrow="Отзывы" title="Отписка от писем об отзывах" lead="Проверяем ссылку…">{null}</AuthCard>;
  if (state === 'error')
    return (
      <AuthCard eyebrow="Отзывы" title="Ссылка не сработала">
        <div className={s.sent}>
          <Alert tone="error">{message}</Alert>
          <Link href="/" className={s.link}>
            ← На главную
          </Link>
        </div>
      </AuthCard>
    );
  const to = result?.email ? ` на ${result.email}` : '';
  return (
    <AuthCard
      eyebrow="Отзывы"
      title={result?.alreadyOff ? 'Вы уже отписаны' : 'Вы отписались'}
      lead={`Больше не будем просить оставить отзыв после доставки${to}. Письма о заказах и доставке продолжат приходить, рассылка об акциях — по вашему согласию в профиле.`}
    >
      <div className={`${s.sent} ${s.sentWide}`}>
        <ButtonLink href="/account" variant="accent">
          В профиль
        </ButtonLink>
      </div>
    </AuthCard>
  );
}
