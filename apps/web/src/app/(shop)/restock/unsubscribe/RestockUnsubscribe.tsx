'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import s from '@/components/auth/auth.module.css';
import { AuthCard } from '@/components/auth/AuthCard';
import { Alert, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Result = { ok: true; cancelled: number; email: string };

/**
 * Отписка от уведомлений о поступлении — как отписка от рассылки (/unsubscribe): запрос уходит из браузера,
 * а не при открытии ссылки, чтобы почтовые сканеры не отписывали человека.
 */
export function RestockUnsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState(token ? '' : 'В ссылке нет кода отписки.');
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return; // не отправлять дважды в StrictMode
    sent.current = true;
    api<Result>('/restock/unsubscribe', { token })
      .then((r) => {
        setResult(r);
        setState('ok');
      })
      .catch((e) => {
        setMessage(isApiError(e) ? e.message : 'Нет связи с сервером.');
        setState('error');
      });
  }, [token]);

  if (state === 'pending') return <AuthCard eyebrow="Уведомления" title="Отписка" lead="Проверяем ссылку…">{null}</AuthCard>;

  if (state === 'error')
    return (
      <AuthCard eyebrow="Уведомления" title="Ссылка не сработала">
        <div className={s.sent}>
          <Alert tone="error">{message}</Alert>
          <Link href="/" className={s.link}>
            ← На главную
          </Link>
        </div>
      </AuthCard>
    );

  return (
    <AuthCard
      eyebrow="Уведомления"
      title={result?.cancelled ? 'Вы отписались' : 'Подписок больше нет'}
      lead={`Не будем присылать письма о поступлении товаров на ${result?.email ?? 'ваш адрес'}. Письма о заказах продолжат приходить.`}
    >
      <div className={`${s.sent} ${s.sentWide}`}>
        <ButtonLink href="/catalog" variant="accent">
          В каталог
        </ButtonLink>
      </div>
    </AuthCard>
  );
}
