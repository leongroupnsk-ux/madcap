'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loginSchema } from '@aesculap/shared';
import { AuthField } from '@/components/auth/AuthField';
import a from '@/components/auth/auth.module.css';
import { useForm } from '@/components/auth/useForm';
import s from '@/components/supplier/public.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

export function SupplierLoginForm() {
  const router = useRouter();
  const [needTotp, setNeedTotp] = useState(false);
  const { errors, formError, pending, submit } = useForm(loginSchema, async (data) => {
    try {
      await api('/auth/login', data);
    } catch (e) {
      if (isApiError(e) && e.code === 'totp_required') setNeedTotp(true);
      throw e;
    }
    router.replace('/supplier');
    router.refresh();
  });

  return (
    <form
      noValidate
      className={a.form}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ email: f.get('email'), password: f.get('password'), totp: needTotp ? f.get('totp') : undefined });
      }}
    >
      {formError && (
        <div className={a.formAlert}>
          <Alert tone="error">{formError}</Alert>
        </div>
      )}
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      <AuthField label="Пароль" name="password" type="password" autoComplete="current-password" placeholder="••••••••" error={errors.password} />
      {needTotp && <AuthField label="Код из приложения" name="totp" inputMode="numeric" autoComplete="one-time-code" placeholder="6 цифр" error={errors.totp} autoFocus />}
      <Link href="/reset-password" className={a.forgot}>
        Забыли пароль?
      </Link>
      <div className={a.actions}>
        <Button type="submit" block className={a.submit} disabled={pending}>
          {pending ? 'Входим…' : 'Войти в кабинет'}
        </Button>
        <div className={s.divider}>ещё не с нами?</div>
        <Link href="/supplier/apply" className={s.applyBtn}>
          Оставить заявку на подключение
        </Link>
        <p className={s.note}>Проверим компанию и подключим выплаты за 1–2 рабочих дня.</p>
      </div>
    </form>
  );
}
