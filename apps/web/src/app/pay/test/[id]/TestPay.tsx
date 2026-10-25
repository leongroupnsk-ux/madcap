'use client';

import { formatRub } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import c from '@/components/shop/checkout.module.css';

type P = { id: string; status: string; amount: number; description: string; shop: string; orderNumber: string };

/**
 * Тестовая платёжная страница (PAYMENTS_DRIVER=fake). В бою покупатель уходит на страницу ЮKassa —
 * данные карты через наш сервер не проходят (ТЗ §6.3).
 */
export function TestPay({ id }: { id: string }) {
  const [p, setP] = useState<P | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<'card' | 'sbp'>('card');
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
    <main className={c.testPay}>
      <div className={c.payWrap}>
        <div className={c.steps}>
          Корзина — Доставка — <b>Оплата</b>
        </div>
        <div className={c.payCard}>
          <div className={c.testBadge}>Тестовый режим оплаты — деньги не списываются. В рабочей версии здесь страница ЮKassa.</div>
          <h1 className={c.payTitle}>ЮKassa</h1>
          {error && <Alert tone="error">{error}</Alert>}
          {p && (
            <>
              <div className={c.payMeta}>
                Магазин: {p.shop} · Заказ № {p.orderNumber}
              </div>
              {p.status !== 'pending' ? (
                <Alert tone={p.status === 'succeeded' ? 'success' : 'error'}>{p.status === 'succeeded' ? 'Платёж уже проведён.' : 'Платёж отменён.'}</Alert>
              ) : (
                <>
                  <div className={c.payList} role="radiogroup" aria-label="Способ оплаты">
                    <button type="button" role="radio" aria-checked={method === 'card'} className={method === 'card' ? c.methodOn : c.method} onClick={() => setMethod('card')}>
                      <span className={c.payItemHead}>Банковская карта</span>
                      <span className={c.payItemText}>Тестовая карта · •••• 4242</span>
                    </button>
                    <button type="button" role="radio" aria-checked={method === 'sbp'} className={method === 'sbp' ? c.methodOn : c.method} onClick={() => setMethod('sbp')}>
                      <span className={c.payItemHead}>СБП</span>
                      <span className={c.payItemText}>Оплата в приложении банка</span>
                    </button>
                  </div>
                  <button type="button" className={c.primary} onClick={() => settle(method)} disabled={busy}>
                    Оплатить {formatRub(p.amount)}
                  </button>
                  <button type="button" className={c.ghost} onClick={() => settle('fail')} disabled={busy}>
                    Имитировать отказ банка
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
