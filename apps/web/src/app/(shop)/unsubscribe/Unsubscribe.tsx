'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import s from '@/components/auth/auth.module.css';
import { AuthCard } from '@/components/auth/AuthCard';
import { Alert, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Result = { ok: true; alreadyRevoked: boolean; email: string | null };

/**
 * Отписка от рассылки — в макете не нарисована, оформлена в стиле кадров .Auth, как подтверждение email.
 * Запрос уходит из браузера, а не при открытии ссылки: почтовые сканеры, открывающие ссылки, не отпишут человека.
 */
export function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState(token ? '' : 'В ссылке нет кода отписки.');
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return; // не отправлять дважды в StrictMode
    sent.current = true;
    api<Result>('/newsletter/unsubscribe', { token })
      .then((r) => {
        setResult(r);
        setState('ok');
      })
      .catch((e) => {
        setMessage(isApiError(e) ? e.message : 'Нет связи с сервером.');
        setState('error');
      });
  }, [token]);

  if (state === 'pending') return <AuthCard eyebrow="Рассылка" title="Отписка от рассылки" lead="Проверяем ссылку…">{null}</AuthCard>;

  if (state === 'error')
    return (
      <AuthCard eyebrow="Рассылка" title="Ссылка не сработала">
        <div className={s.sent}>
          <Alert tone="error">{message}</Alert>
          <p className={s.status}>
            Отключить рассылку можно в <Link href="/account" className={s.forgot}>профиле</Link> — снимите отметку «письма об акциях».
          </p>
          <Link href="/" className={s.link}>
            ← На главную
          </Link>
        </div>
      </AuthCard>
    );

  const to = result?.email ? ` на ${result.email}` : '';
  return (
    <AuthCard
      eyebrow="Рассылка"
      title={result?.alreadyRevoked ? 'Вы уже отписаны' : 'Вы отписались'}
      lead={`Больше не будем присылать письма об акциях и подборках${to}. Письма о заказах, доставке и безопасности аккаунта продолжат приходить.`}
    >
      <div className={`${s.sent} ${s.sentWide}`}>
        <ButtonLink href="/catalog" variant="accent">
          В каталог
        </ButtonLink>
        <p className={s.status}>
          Передумали? Рассылку можно снова включить в <Link href="/account" className={s.forgot}>профиле</Link>.
        </p>
      </div>
    </AuthCard>
  );
}
