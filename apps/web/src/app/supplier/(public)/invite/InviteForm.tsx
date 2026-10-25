'use client';

import { useRouter } from 'next/navigation';
import { acceptInviteSchema } from '@aesculap/shared';
import { AuthField } from '@/components/auth/AuthField';
import a from '@/components/auth/auth.module.css';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';

export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const { errors, formError, pending, submit } = useForm(acceptInviteSchema, async (data) => {
    await api('/auth/accept-invite', data);
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
        void submit({ token, password: f.get('password'), passwordRepeat: f.get('passwordRepeat') });
      }}
    >
      {(formError || errors.token) && (
        <div className={a.formAlert}>
          <Alert tone="error">{formError ?? 'Ссылка недействительна. Попросите прислать приглашение заново.'}</Alert>
        </div>
      )}
      <AuthField label="Пароль" name="password" type="password" autoComplete="new-password" placeholder="Не менее 8 символов" error={errors.password} />
      <AuthField label="Повторите пароль" name="passwordRepeat" type="password" autoComplete="new-password" error={errors.passwordRepeat} />
      <div className={a.actions}>
        <Button type="submit" block className={a.submit} disabled={pending}>
          {pending ? 'Сохраняем…' : 'Сохранить и войти'}
        </Button>
      </div>
    </form>
  );
}
