'use client';

import { useState } from 'react';
import type { ZodTypeAny, z } from 'zod';
import { isApiError } from '@/lib/api';

/** Клиентская валидация той же zod-схемой, что и на сервере, + ошибки сервера по полям. */
export function useForm<S extends ZodTypeAny>(schema: S, onValid: (data: z.infer<S>) => Promise<void>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    try {
      await onValid(parsed.data);
    } catch (e) {
      if (isApiError(e)) {
        if (e.errors) setErrors(e.errors);
        setFormError(e.errors ? null : e.message);
      } else {
        setFormError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      }
    } finally {
      setPending(false);
    }
  }

  return { errors, formError, pending, submit };
}
