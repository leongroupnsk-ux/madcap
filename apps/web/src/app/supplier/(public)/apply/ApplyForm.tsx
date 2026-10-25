'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supplierApplicationSchema } from '@aesculap/shared';
import { AuthCheckbox, AuthField } from '@/components/auth/AuthField';
import a from '@/components/auth/auth.module.css';
import { useForm } from '@/components/auth/useForm';
import s from '@/components/supplier/public.module.css';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';

export function ApplyForm() {
  const [done, setDone] = useState(false);
  const { errors, formError, pending, submit } = useForm(supplierApplicationSchema, async (data) => {
    await api('/supplier-applications', data);
    setDone(true);
  });

  if (done)
    return (
      <div className={a.form}>
        <Alert tone="success">Заявка отправлена. Менеджер свяжется с вами в течение 2 часов в рабочее время; копия — у вас на почте.</Alert>
        <Link href="/supplier/login" className={a.link}>
          ← Ко входу для поставщиков
        </Link>
      </div>
    );

  return (
    <form
      noValidate
      className={a.form}
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        void submit({ ...f, acceptPdn: f.acceptPdn === 'on' });
      }}
    >
      {formError && (
        <div className={a.formAlert}>
          <Alert tone="error">{formError}</Alert>
        </div>
      )}
      <AuthField label="Название компании" name="company" placeholder="ООО Компания" error={errors.company} />
      <AuthField label="ИНН" name="inn" inputMode="numeric" placeholder="0000 0000 0000" error={errors.inn} />
      <AuthField label="Контактное лицо" name="contactName" placeholder="Имя и фамилия" error={errors.contactName} />
      <AuthField label="Телефон" name="phone" type="tel" placeholder="+7 999 123-45-67" error={errors.phone} />
      <AuthField label="Email" name="email" type="email" placeholder="sales@company.ru" error={errors.email} />
      <AuthField label="Ассортимент" name="assortment" placeholder="скраб-костюмы, топы, брюки, шапочки…" error={errors.assortment} />
      <AuthCheckbox name="acceptPdn" error={errors.acceptPdn}>
        Согласен на обработку персональных данных по <Link href="/legal/privacy">политике</Link> и с <Link href="/legal/suppliers">условиями для поставщиков</Link>
      </AuthCheckbox>
      <div className={`${a.actions} ${a.actionsAfterCheck}`}>
        <Button type="submit" block className={a.submit} disabled={pending}>
          {pending ? 'Отправляем…' : 'Отправить заявку'}
        </Button>
        <p className={s.note}>Менеджер свяжется с вами в течение 2 часов в рабочее время.</p>
      </div>
    </form>
  );
}
