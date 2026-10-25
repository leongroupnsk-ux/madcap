'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { forgotPasswordSchema, PASSWORD_MIN, resetPasswordSchema } from '@aesculap/shared';
import s from '@/components/auth/auth.module.css';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthField } from '@/components/auth/AuthField';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

/** Шаг 1 (кадр .Auth-Forget-password-1) и шаг 2 «Проверьте почту» (.Auth-Forget-password-2). */
export function ForgotFlow() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { errors, formError, pending, submit } = useForm(forgotPasswordSchema, async (data) => {
    await api('/auth/forgot-password', data);
    setSentTo(data.email);
  });

  if (sentTo) return <SentCard email={sentTo} />;

  return (
    <AuthCard title="Восстановление пароля" lead="Введите email, указанный при регистрации.">
      <form
        className={s.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit({ email: new FormData(e.currentTarget).get('email') });
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
        <div className={`${s.actions} ${s.actionsWide}`}>
          <Button type="submit" className={s.submit} disabled={pending}>
            {pending ? 'Отправляем…' : 'Отправить ссылку'}
          </Button>
          <Link href="/login" className={s.link}>
            ← Вернуться ко входу
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

function SentCard({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'pending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  // Повторная отправка — тот же запрос; лимиты частоты действуют на сервере
  async function resend() {
    setState('pending');
    try {
      await api('/auth/forgot-password', { email });
      setState('sent');
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      setState('error');
    }
  }

  return (
    <AuthCard
      title="Проверьте почту"
      lead={
        <>
          Мы отправили ссылку для восстановления пароля на указанный email. Ссылка действует 1 час.
        </>
      }
    >
      <div className={s.sent}>
        {state === 'error' && <Alert tone="error">{error}</Alert>}
        {state === 'sent' ? (
          <p className={s.status} role="status">
            Письмо отправлено повторно на {email}.
          </p>
        ) : (
          <button type="button" className={s.resend} onClick={() => void resend()} disabled={state === 'pending'}>
            {state === 'pending' ? 'Отправляем…' : 'Отправить письмо ещё раз'}
          </button>
        )}
        <Link href="/login" className={s.link}>
          ← Вернуться ко входу
        </Link>
      </div>
    </AuthCard>
  );
}

/** Новый пароль по ссылке из письма — в макете не нарисован, оформлен в стиле кадров .Auth. */
export function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { errors, formError, pending, submit } = useForm(resetPasswordSchema, async (data) => {
    await api('/auth/reset-password', data);
    router.replace('/account');
    router.refresh();
  });

  return (
    <AuthCard title="Новый пароль" lead="Придумайте новый пароль для входа в личный кабинет.">
      <form
        className={s.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit({ token, password: f.get('password'), passwordRepeat: f.get('passwordRepeat') });
        }}
      >
        {formError && (
          <Alert tone="error">
            {formError} <Link href="/reset-password">Запросить ссылку</Link>
          </Alert>
        )}
        <AuthField
          label="Новый пароль"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={`Не менее ${PASSWORD_MIN} символов`}
          error={errors.password}
        />
        <AuthField label="Повторите пароль" name="passwordRepeat" type="password" autoComplete="new-password" placeholder="••••••••" error={errors.passwordRepeat} />
        <div className={`${s.actions} ${s.actionsWide}`}>
          <Button type="submit" className={s.submit} disabled={pending}>
            {pending ? 'Сохраняем…' : 'Сохранить и войти'}
          </Button>
          <Link href="/login" className={s.link}>
            ← Вернуться ко входу
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}
