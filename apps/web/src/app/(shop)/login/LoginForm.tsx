'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loginSchema } from '@aesculap/shared';
import s from '@/components/auth/auth.module.css';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button, Field } from '@/components/ui';
import { api } from '@/lib/api';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const { errors, formError, pending, submit } = useForm(loginSchema, async (data) => {
    await api('/auth/login', data);
    router.replace(next);
    router.refresh();
  });

  return (
    <form
      className={s.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ email: f.get('email'), password: f.get('password') });
      }}
    >
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      <Field label="Пароль" name="password" type="password" autoComplete="current-password" error={errors.password} />
      <Link href="/reset-password" className={s.forgot}>
        Забыли пароль?
      </Link>
      <Button type="submit" block disabled={pending}>
        {pending ? 'Входим…' : 'Войти'}
      </Button>
      <div className={s.footer} style={{ marginTop: 0 }}>
        <Link href="/register">Создать аккаунт</Link>
      </div>
    </form>
  );
}
