'use client';

import { plural } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import { Alert, Button, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import o from '@/components/shop/order.module.css';

type Order = { number: string; status: string; paymentStatus: string; eta: string | null; recipient: { email: string }; shipments: unknown[] };

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
        const o = await api<Order>(`/orders/${number}`);
        if (stop) return;
        setOrder(o);
        if (o.status === 'pending_payment' && o.paymentStatus === 'pending') {
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
      <section className={o.hero}>
        <div>
          <Alert tone="error">{error}</Alert>
          <p style={{ marginTop: 16 }}>
            <ButtonLink href="/account" variant="outline">
              В профиль
            </ButtonLink>
          </p>
        </div>
      </section>
    );
  }
  if (!order || (order.status === 'pending_payment' && order.paymentStatus === 'pending')) {
    return (
      <section className={o.hero}>
        <div>
          <div className={o.spinner} />
          <h1>Проверяем оплату…</h1>
          <p className={o.muted}>{slow ? 'Банк отвечает дольше обычного. Страница обновится сама, а письмо придёт на почту.' : 'Обычно это занимает несколько секунд.'}</p>
        </div>
      </section>
    );
  }
  if (order.status === 'paid') {
    const eta = order.eta ? new Date(order.eta).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;
    return (
      <section className={o.hero}>
        <div>
          <div className="eyebrow">
            {order.shipments.length} {plural(order.shipments.length, 'отправление', 'отправления', 'отправлений')}
          </div>
          <h1>Заказ № {order.number} оформлен.</h1>
          <p>Оплата прошла.{eta && ` Доставим ориентировочно ${eta}.`}</p>
          <p className={o.muted} style={{ marginBottom: 20 }}>
            Подтверждение отправили на {order.recipient.email}
          </p>
          <div className={o.actions} style={{ justifyContent: 'center' }}>
            <ButtonLink href={`/account/orders/${order.number}`}>Перейти к заказу</ButtonLink>
            <ButtonLink href="/catalog" variant="outline">
              Продолжить покупки
            </ButtonLink>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={o.hero}>
      <div>
        <div className="eyebrow">Заказ № {order.number}</div>
        <h1>{order.status === 'cancelled' ? 'Заказ отменён.' : 'Оплата не прошла.'}</h1>
        <p className={o.muted} style={{ marginBottom: 20 }}>
          {order.status === 'cancelled' ? 'Время на оплату истекло или заказ отменён. Резерв снят.' : 'Банк отклонил платёж или он был прерван. Деньги не списаны. Заказ ждёт оплаты 30 минут.'}
        </p>
        <div className={o.actions} style={{ justifyContent: 'center' }}>
          {order.status === 'pending_payment' && (
            <Button onClick={retry} disabled={busy}>
              Попробовать ещё раз
            </Button>
          )}
          <ButtonLink href={`/account/orders/${order.number}`} variant="outline">
            Детали заказа
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
