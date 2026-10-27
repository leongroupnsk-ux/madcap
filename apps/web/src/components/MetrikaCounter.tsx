'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CONSENT_EVENT, analyticsAllowed } from '@/lib/consent';
import { metrikaHit, startMetrika } from '@/lib/metrika';

/**
 * Счётчик Метрики на клиенте: ждёт согласия на аналитические cookie (уже данного или из баннера в этой вкладке),
 * затем грузит tag.js и шлёт хиты на каждый переход. Без согласия — ни скрипта, ни запросов.
 */
export function MetrikaCounter({ id }: { id: number }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const start = () => {
      if (!analyticsAllowed()) return;
      startMetrika(id).then(() => setReady(true));
    };
    start();
    window.addEventListener(CONSENT_EVENT, start);
    return () => window.removeEventListener(CONSENT_EVENT, start);
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    const url = window.location.href;
    if (prev.current === url) return;
    metrikaHit(url, prev.current ?? document.referrer);
    prev.current = url;
  }, [ready, pathname, search]);

  return null;
}
