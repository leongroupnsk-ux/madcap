'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { forgotPasswordSchema, resetPasswordSchema } from '@aesculap/shared';
import s from '@/components/auth/auth.module.css';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button, Field } from '@/components/ui';
import { api } from '@/lib/api';

export function ForgotForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { errors, formError, pending, submit } = useForm(forgotPasswordSchema, async (data) => {
    await api('/auth/forgot-password', data);
    setSentTo(data.email);
  });

  if (sentTo) {
    return (
      <div className={s.form}>
        <Alert tone="success">
          Если аккаунт с адресом {sentTo} существует, мы отправили на него ссылку для смены пароля. Она действует 1 час.
        </Alert>
        <div className={s.footer}>
          <Link href="/login">← Вернуться ко входу</Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className={s.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ email: new FormData(e.currentTarget).get('email') });
      }}
    >
      <p className={s.lead}>Введите email, указанный при регистрации.</p>
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      <Button type="submit" block disabled={pending}>
        {pending ? 'Отправляем…' : 'Отправить ссылку'}
      </Button>
      <div className={s.footer} style={{ marginTop: 0 }}>
        <Link href="/login">← Вернуться ко входу</Link>
      </div>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { errors, formError, pending, submit } = useForm(resetPasswordSchema, async (data) => {
    await api('/auth/reset-password', data);
    router.replace('/account');
    router.refresh();
  });

  return (
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
      <Field label="Новый пароль" name="password" type="password" autoComplete="new-password" placeholder="Не менее 8 символов" error={errors.password} />
      <Field label="Повторите пароль" name="passwordRepeat" type="password" autoComplete="new-password" error={errors.passwordRepeat} />
      <Button type="submit" block disabled={pending}>
        {pending ? 'Сохраняем…' : 'Сохранить и войти'}
      </Button>
    </form>
  );
}
