'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loginSchema } from '@aesculap/shared';
import s from '@/components/auth/auth.module.css';
import { AuthField } from '@/components/auth/AuthField';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  // Сотрудникам с включённой 2FA сервер отвечает totp_required — тогда показываем поле кода
  const [needTotp, setNeedTotp] = useState(false);
  const { errors, formError, pending, submit, captcha } = useForm(loginSchema, async (data, { headers }) => {
    try {
      await api('/auth/login', data, undefined, headers);
    } catch (e) {
      if (isApiError(e) && e.code === 'totp_required') setNeedTotp(true);
      throw e;
    }
    router.replace(next);
    router.refresh();
  });
  const registerHref = next === '/account' ? '/register' : `/register?next=${encodeURIComponent(next)}`;

  return (
    <form
      className={s.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ email: f.get('email'), password: f.get('password'), totp: needTotp ? f.get('totp') : undefined });
      }}
    >
      {formError && <Alert tone="error">{formError}</Alert>}
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      <AuthField label="Пароль" name="password" type="password" autoComplete="current-password" placeholder="••••••••" error={errors.password} />
      {needTotp && (
        <AuthField
          label="Код из приложения"
          name="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6 цифр"
          error={errors.totp}
          autoFocus
        />
      )}
      {captcha}
      <Link href="/reset-password" className={s.forgot}>
        Забыли пароль?
      </Link>
      <div className={s.actions}>
        <Button type="submit" className={s.submit} disabled={pending}>
          {pending ? 'Входим…' : 'Войти'}
        </Button>
        <Link href={registerHref} className={s.link}>
          Создать аккаунт
        </Link>
      </div>
    </form>
  );
}
