'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button, ButtonLink } from '@/components/ui';

/**
 * Сбой при загрузке страницы витрины — чаще всего API временно недоступен (перезапуск при выкладке, перегрузка).
 * Код ответа — 500, а не 404: поисковик зайдёт позже и не уберёт страницу из выдачи (lib/server-api.ts, pageMissing).
 */
export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="container" style={{ padding: '80px var(--gutter)', textAlign: 'center' }}>
      <div className="eyebrow">Временная ошибка</div>
      <h1 style={{ fontSize: 48, margin: '12px 0 16px' }}>Не получилось загрузить страницу</h1>
      <p style={{ color: 'var(--c-text-muted)' }}>Сайт ненадолго перегружен или обновляется. Попробуйте ещё раз через минуту.</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(() => {
              router.refresh();
              reset();
            })
          }
        >
          {pending ? 'Загружаем…' : 'Попробовать ещё раз'}
        </Button>
        <ButtonLink href="/" variant="outline">
          На главную
        </ButtonLink>
      </div>
    </section>
  );
}
