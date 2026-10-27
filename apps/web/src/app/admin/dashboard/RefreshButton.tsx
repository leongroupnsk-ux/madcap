'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';

/** Пересчитать дашборд, не дожидаясь истечения кэша (5 минут) */
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api('/admin/dashboard?refresh=1');
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Обновляем…' : 'Обновить'}
    </Button>
  );
}
