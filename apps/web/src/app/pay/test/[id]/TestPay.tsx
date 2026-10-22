'use client';

import { formatRub } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import o from '@/components/shop/order.module.css';

type P = { id: string; status: string; amount: number; description: string; shop: string; orderNumber: string };

/**
 * Тестовая платёжная страница (PAYMENTS_DRIVER=fake). В бою покупатель уходит на страницу ЮKassa —
 * данные карты через наш сервер не проходят (ТЗ §6.3).
 */
export function TestPay({ id }: { id: string }) {
  const [p, setP] = useState<P | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<P>(`/payments/test/${encodeURIComponent(id)}`).then(setP).catch((e) => setError(isApiError(e) ? e.message : 'Платёж не найден'));
  }, [id]);

  const settle = async (result: 'card' | 'sbp' | 'fail') => {
    setBusy(true);
    try {
      const r = await api<{ orderNumber: string }>(`/payments/test/${encodeURIComponent(id)}`, { result });
      window.location.href = `/orders/${r.orderNumber}/result`;
    } catch (e) {
      setBusy(false);
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
    }
  };

  return (
    <main className={o.hero} style={{ background: 'var(--c-bg)' }}>
      <div className={o.panel} style={{ width: 'min(440px, 100%)', textAlign: 'left', display: 'grid', gap: 14 }}>
        <div style={{ background: '#fdf3e7', color: '#9a5b13', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>
          Тестовый режим оплаты — деньги не списываются. В рабочей версии здесь страница ЮKassa.
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {p && (
          <>
            <div className={o.muted}>
              Магазин: {p.shop} · Заказ № {p.orderNumber}
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 40 }}>{formatRub(p.amount)}</div>
            {p.status !== 'pending' ? (
              <Alert tone={p.status === 'succeeded' ? 'success' : 'error'}>{p.status === 'succeeded' ? 'Платёж уже проведён.' : 'Платёж отменён.'}</Alert>
            ) : (
              <>
                <Button onClick={() => settle('card')} disabled={busy}>
                  Оплатить картой •••• 4242
                </Button>
                <Button variant="outline" onClick={() => settle('sbp')} disabled={busy}>
                  Оплатить через СБП
                </Button>
                <Button variant="ghost" onClick={() => settle('fail')} disabled={busy}>
                  Имитировать отказ банка
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
