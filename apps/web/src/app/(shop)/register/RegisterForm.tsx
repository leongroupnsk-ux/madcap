'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PASSWORD_MIN, registerSchema } from '@aesculap/shared';
import s from '@/components/auth/auth.module.css';
import { AuthCheckbox, AuthField } from '@/components/auth/AuthField';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button } from '@/components/ui';
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
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="name@example.ru" error={errors.email} />
      {/* В макете «не менее 6» — ошибка макета; минимум берём из общей схемы (ТЗ §12 п.14) */}
      <AuthField
        label="Пароль"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder={`Не менее ${PASSWORD_MIN} символов`}
        error={errors.password}
      />
      <AuthField label="Повторите пароль" name="passwordRepeat" type="password" autoComplete="new-password" placeholder="••••••••" error={errors.passwordRepeat} />
      <AuthCheckbox name="acceptTerms" error={errors.acceptTerms}>
        Я согласен с <Link href="/legal/privacy">политикой персональных данных</Link> и <Link href="/legal/offer">офертой</Link>
      </AuthCheckbox>
      <div className={`${s.actions} ${s.actionsAfterCheck}`}>
        <Button type="submit" className={s.submit} disabled={pending}>
          {pending ? 'Создаём…' : 'Создать аккаунт'}
        </Button>
        <p className={s.note}>После регистрации предлагаем Вам пройти анкету подбора капсулы (5 минут).</p>
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className={s.link}>
          ← Вернуться ко входу
        </Link>
      </div>
    </form>
  );
}
