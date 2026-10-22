'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loginSchema } from '@aesculap/shared';
import { useForm } from '@/components/auth/useForm';
import s from '@/components/supplier/public.module.css';
import { Alert, Button, ButtonLink, Field } from '@/components/ui';
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
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ email: f.get('email'), password: f.get('password'), totp: needTotp ? f.get('totp') : undefined });
      }}
    >
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      <Field label="Пароль" name="password" type="password" autoComplete="current-password" error={errors.password} />
      {needTotp && <Field label="Код из приложения" name="totp" inputMode="numeric" autoComplete="one-time-code" placeholder="6 цифр" error={errors.totp} autoFocus />}
      <Link href="/reset-password" style={{ fontSize: 13, color: 'var(--c-sale)', textDecoration: 'none', justifySelf: 'end', marginTop: -8 }}>
        Забыли пароль?
      </Link>
      <Button type="submit" block disabled={pending}>
        {pending ? 'Входим…' : 'Войти в кабинет'}
      </Button>
      <div className={s.divider}>ещё не с нами?</div>
      <ButtonLink href="/supplier/apply" variant="soft">
        Оставить заявку на подключение
      </ButtonLink>
      <p className={s.note}>Проверим компанию и подключим выплаты за 1–2 рабочих дня.</p>
    </form>
  );
}
