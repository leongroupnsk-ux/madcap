'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { registerSchema } from '@aesculap/shared';
import s from '@/components/auth/auth.module.css';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button, Checkbox, Field } from '@/components/ui';
import { api } from '@/lib/api';

export function RegisterForm({ next }: { next: string | null }) {
  const router = useRouter();
  const { errors, formError, pending, submit } = useForm(registerSchema, async (data) => {
    await api('/auth/register', data);
    router.replace(next ?? '/account?welcome=1');
    router.refresh();
  });

  return (
    <form
      className={s.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({
          email: f.get('email'),
          password: f.get('password'),
          passwordRepeat: f.get('passwordRepeat'),
          acceptTerms: f.get('acceptTerms') === 'on',
        });
      }}
    >
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      <Field label="Пароль" name="password" type="password" autoComplete="new-password" placeholder="Не менее 8 символов" error={errors.password} />
      <Field label="Повторите пароль" name="passwordRepeat" type="password" autoComplete="new-password" error={errors.passwordRepeat} />
      <Checkbox name="acceptTerms" error={errors.acceptTerms}>
        Я согласен с <Link href="/legal/privacy">политикой персональных данных</Link> и <Link href="/legal/offer">офертой</Link>
      </Checkbox>
      <Button type="submit" block disabled={pending}>
        {pending ? 'Создаём…' : 'Создать аккаунт'}
      </Button>
      <p className={s.lead} style={{ margin: 0 }}>
        После регистрации предложим пройти анкету подбора капсулы (5 минут).
      </p>
      <div className={s.footer} style={{ marginTop: 0 }}>
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Уже есть аккаунт? Войти</Link>
      </div>
    </form>
  );
}
