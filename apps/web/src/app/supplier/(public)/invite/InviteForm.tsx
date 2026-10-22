'use client';

import { useRouter } from 'next/navigation';
import { acceptInviteSchema } from '@aesculap/shared';
import { useForm } from '@/components/auth/useForm';
import { Alert, Button, Field } from '@/components/ui';
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
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ token, password: f.get('password'), passwordRepeat: f.get('passwordRepeat') });
      }}
    >
      {(formError || errors.token) && <Alert tone="error">{formError ?? 'Ссылка недействительна. Попросите прислать приглашение заново.'}</Alert>}
      <Field label="Пароль" name="password" type="password" autoComplete="new-password" placeholder="Не менее 8 символов" error={errors.password} />
      <Field label="Повторите пароль" name="passwordRepeat" type="password" autoComplete="new-password" error={errors.passwordRepeat} />
      <Button type="submit" block disabled={pending}>
        {pending ? 'Сохраняем…' : 'Сохранить и войти'}
      </Button>
    </form>
  );
}
