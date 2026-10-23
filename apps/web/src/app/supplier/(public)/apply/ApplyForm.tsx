'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supplierApplicationSchema } from '@aesculap/shared';
import { useForm } from '@/components/auth/useForm';
import s from '@/components/supplier/public.module.css';
import { Alert, Button, Checkbox, Field } from '@/components/ui';
import { api } from '@/lib/api';

export function ApplyForm() {
  const [done, setDone] = useState(false);
  const { errors, formError, pending, submit } = useForm(supplierApplicationSchema, async (data) => {
    await api('/supplier-applications', data);
    setDone(true);
  });

  if (done)
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Alert tone="success">Заявка отправлена. Менеджер свяжется с вами в течение 2 часов в рабочее время; копия — у вас на почте.</Alert>
        <Link href="/supplier/login" style={{ color: 'var(--c-sale)', textDecoration: 'none', fontSize: 14 }}>
          ← Ко входу для поставщиков
        </Link>
      </div>
    );

  return (
    <form
      noValidate
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        void submit({ ...f, acceptPdn: f.acceptPdn === 'on' });
      }}
    >
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field label="Название компании" name="company" placeholder="ООО Компания" error={errors.company} />
      <Field label="ИНН" name="inn" inputMode="numeric" placeholder="0000 0000 0000" error={errors.inn} />
      <Field label="Контактное лицо" name="contactName" placeholder="Имя и фамилия" error={errors.contactName} />
      <Field label="Телефон" name="phone" type="tel" placeholder="+7 999 123-45-67" error={errors.phone} />
      <Field label="Email" name="email" type="email" placeholder="sales@company.ru" error={errors.email} />
      <Field label="Ассортимент" name="assortment" placeholder="скраб-костюмы, топы, брюки, шапочки…" error={errors.assortment} />
      <Checkbox name="acceptPdn" error={errors.acceptPdn}>
        Согласен на обработку персональных данных по <Link href="/legal/privacy">политике</Link> и с <Link href="/legal/suppliers">условиями для поставщиков</Link>
      </Checkbox>
      <Button type="submit" block disabled={pending}>
        {pending ? 'Отправляем…' : 'Отправить заявку'}
      </Button>
      <p className={s.note}>Менеджер свяжется с вами в течение 2 часов в рабочее время.</p>
    </form>
  );
}
