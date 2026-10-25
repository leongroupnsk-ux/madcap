'use client';

import { plural } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import c from '@/components/shop/checkout.module.css';

type Order = { number: string; status: string; paymentStatus: string; eta: string | null; recipient: { email: string }; shipments: { deliveryType: 'pvz' | 'courier' }[] };

/**
 * Возврат со страницы оплаты (ТЗ §6.4). Статус берём из заказа — его меняет только вебхук платёжки,
 * поэтому пока он не пришёл, показываем «Проверяем оплату…».
 */
export function Result({ number }: { number: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let stop = false;
    let n = 0;
    const load = async () => {
      try {
        const res = await api<Order>(`/orders/${number}`);
        if (stop) return;
        setOrder(res);
        if (res.status === 'pending_payment' && res.paymentStatus === 'pending') {
          n += 1;
          if (n > 15) setSlow(true);
          setTimeout(load, n < 10 ? 1500 : 4000);
        }
      } catch (e) {
        if (!stop) setError(isApiError(e) ? e.message : 'Нет связи с сервером');
      }
    };
    void load();
    return () => {
      stop = true;
    };
  }, [number]);

  const retry = async () => {
    setBusy(true);
    try {
      const r = await api<{ confirmationUrl: string | null }>(`/orders/${number}/pay`, {});
      window.location.href = r.confirmationUrl ?? `/orders/${number}/result`;
    } catch (e) {
      setBusy(false);
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
    }
  };

  if (error) {
    return (
      <section className={c.result}>
        <div className={c.resultBox}>
          <Alert tone="error">{error}</Alert>
          <div className={c.resultActions}>
            <Link href="/account" className={c.ghost}>
              В профиль
            </Link>
          </div>
        </div>
      </section>
    );
  }
  if (!order || (order.status === 'pending_payment' && order.paymentStatus === 'pending')) {
    return (
      <section className={c.result}>
        <div className={c.resultBox} aria-live="polite">
          <div className={c.spinner} />
          <h1 className={c.resultTitle} style={{ fontSize: 44, lineHeight: '48px' }}>
            Проверяем оплату…
          </h1>
          <p className={c.resultText}>{slow ? 'Банк отвечает дольше обычного. Страница обновится сама, а письмо придёт на почту.' : 'Обычно это занимает несколько секунд.'}</p>
        </div>
      </section>
    );
  }
  if (order.status === 'paid') {
    const eta = order.eta ? new Date(order.eta).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;
    const n = order.shipments.length;
    // Способ доставки — по отправлению: при одном называем его, при нескольких — только число отправлений
    const how = n === 1 ? (order.shipments[0].deliveryType === 'pvz' ? 'в пункт выдачи' : 'курьером') : null;
    return (
      <section className={c.result}>
        <div className={c.resultBox}>
          <div className={c.check} aria-hidden>
            ✓
          </div>
          <div className={c.resultEyebrow}>Заказ № {order.number}</div>
          <h1 className={c.resultTitle}>
            Заказ <span>оформлен.</span>
          </h1>
          <p className={c.resultText}>
            Оплата прошла.
            {n > 1 && ` ${n} ${plural(n, 'отправление', 'отправления', 'отправлений')}`}
            {eta && (how ? ` Доставим ${how} ориентировочно ${eta}.` : ` — доставим ориентировочно к ${eta}.`)}
          </p>
          <p className={c.resultText}>Подтверждение отправили на {order.recipient.email}.</p>
          <div className={c.resultActions}>
            <Link href={`/account/orders/${order.number}`} className={c.primary}>
              Перейти к заказу
            </Link>
            <Link href="/catalog" className={c.ghost}>
              Продолжить покупки
            </Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={c.result}>
      <div className={c.resultBox}>
        <div className={c.checkBad} aria-hidden>
          ×
        </div>
        <div className={c.resultEyebrow}>Заказ № {order.number}</div>
        <h1 className={c.resultTitle}>{order.status === 'cancelled' ? 'Заказ отменён.' : <>Оплата <span>не прошла.</span></>}</h1>
        <p className={c.resultText}>
          {order.status === 'cancelled' ? 'Время на оплату истекло или заказ отменён. Резерв снят.' : 'Банк отклонил платёж или он был прерван. Деньги не списаны. Заказ ждёт оплаты 30 минут.'}
        </p>
        <div className={c.resultActions}>
          {order.status === 'pending_payment' && (
            <button type="button" className={c.primary} onClick={retry} disabled={busy}>
              Попробовать ещё раз
            </button>
          )}
          <Link href={`/account/orders/${order.number}`} className={c.ghost}>
            Детали заказа
          </Link>
        </div>
      </div>
    </section>
  );
}
