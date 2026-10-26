'use client';

import { useRef, useState } from 'react';
import type { ZodTypeAny, z } from 'zod';
import { isApiError } from '@/lib/api';
import { useCaptcha } from './Captcha';

/** Заголовки для запроса формы: X-Captcha-Token, если пользователь только что решил капчу */
export type FormContext = { headers?: Record<string, string> };

/**
 * Клиентская валидация той же zod-схемой, что и на сервере, + ошибки сервера по полям.
 * Если сервер попросил капчу (captcha_required), в форме появляется виджет — его надо вывести через `captcha`;
 * после решения запрос повторяется сам с последними введёнными значениями.
 */
export function useForm<S extends ZodTypeAny>(schema: S, onValid: (data: z.infer<S>, ctx: FormContext) => Promise<void>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const last = useRef<{ values: unknown } | null>(null);
  const submitRef = useRef<(values: unknown) => Promise<void>>(async () => {});
  const captcha = useCaptcha(() => {
    if (last.current) void submitRef.current(last.current.values);
  });

  async function submit(values: unknown) {
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(true);
    last.current = { values };
    try {
      await onValid(parsed.data, { headers: captcha.take() });
    } catch (e) {
      if (isApiError(e)) {
        if (e.code === 'captcha_required') captcha.require();
        if (e.errors) setErrors(e.errors);
        setFormError(e.errors ? null : e.message);
      } else {
        setFormError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      }
    } finally {
      setPending(false);
    }
  }
  submitRef.current = submit;

  return { errors, formError, pending, submit, captcha: captcha.element };
}
