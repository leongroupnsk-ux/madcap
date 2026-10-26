'use client';

import { COLOR_TYPES, PREMIUM_CONTACTS, PREMIUM_LEAD_STATUSES, bodyTypeOf, colorTypeOf, formatRub, type PremiumAnswers, type PremiumLeadStatus } from '@aesculap/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type CapItem = { slot: string; slotLabel: string; slug: string; title: string; brand: string; color: string; size: string; price: number; oldPrice: number | null };
type View = {
  id: string; name: string; phone: string; contact: keyof typeof PREMIUM_CONTACTS; status: PremiumLeadStatus; managerComment: string | null; createdAt: string; updatedAt: string;
  userEmail: string | null; capsule: { variantNo: number; title: string; size: string | null; total: number; budget: number | null; items: CapItem[] };
  answers: PremiumAnswers; workplaces: string[]; budgetLabel: string | null;
};
const v = (x: string | number | null | undefined, unit = '') => (x == null || x === '' ? '—' : `${x}${unit}`);
const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** Карточка заявки премиум: контакты, капсула на момент заявки, ответы анкеты, статус и комментарий менеджера */
export default function AdminPremiumLeadPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<View | null>(null);
  const [status, setStatus] = useState<PremiumLeadStatus>('new');
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = (x: View) => {
    setD(x);
    setStatus(x.status);
    setComment(x.managerComment ?? '');
  };
  useEffect(() => {
    api<View>(`/admin/premium/${id}`).then(apply).catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
  }, [id]);
  if (!d) return msg ? <Alert tone="error">{msg.text}</Alert> : null;
  const a = d.answers;
  const ct = colorTypeOf(a.skinTone, a.hair);
  const rows: [string, string][] = [
    ['Имя в анкете', v(a.name)],
    ['Пол', a.gender === 'female' ? 'Женский' : a.gender === 'male' ? 'Мужской' : '—'],
    ['Возраст', v(a.age)],
    ['Рост / вес', `${v(a.heightCm, ' см')} / ${v(a.weightKg, ' кг')}`],
    ['Размеры', `верх ${v(a.sizeTop)} · низ ${v(a.sizeBottom)} · обувь ${v(a.sizeShoes)}`],
    ['Тип фигуры', v(bodyTypeOf(a.sizeTop, a.sizeBottom))],
    ['Цветотип', ct ? COLOR_TYPES[ct].label : '—'],
    ['Где работает', d.workplaces.join(', ') || '—'],
    ['Бюджет', v(d.budgetLabel)],
  ];

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">
            <Link href="/admin/premium">Заявки премиум</Link>
          </div>
          <h1>{d.name}</h1>
          <div className={s.muted}>
            {PREMIUM_LEAD_STATUSES[d.status]} · {date(d.createdAt)}
          </div>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={s.detail} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <section className={s.panel}>
            <h2>
              {d.capsule.title} · вариант {d.capsule.variantNo}
              {d.capsule.size ? ` · размер ${d.capsule.size}` : ''}
            </h2>
            <div className={s.scroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Слот</th>
                    <th scope="col">Вещь</th>
                    <th scope="col">Цвет, размер</th>
                    <th scope="col">Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {d.capsule.items.map((it) => (
                    <tr key={it.slot}>
                      <td>{it.slotLabel}</td>
                      <td>
                        <Link className={s.link} href={`/product/${it.slug}`} target="_blank">
                          {it.title}
                        </Link>
                        <div className={s.muted}>{it.brand}</div>
                      </td>
                      <td>
                        {it.color} · {it.size}
                      </td>
                      <td>{formatRub(it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              <b>Итого: {formatRub(d.capsule.total)}</b>
              {d.capsule.budget ? <span className={s.muted}> · бюджет до {formatRub(d.capsule.budget)}</span> : null}
            </p>
            <p className={s.muted}>Цены — на момент заявки. Онлайн-оплаты нет: заказ подтверждает менеджер.</p>
          </section>
          <section className={s.panel}>
            <h2>Ответы анкеты</h2>
            <table className={s.table}>
              <tbody>
                {rows.map(([k, val]) => (
                  <tr key={k}>
                    <td className={s.muted} style={{ width: 180 }}>
                      {k}
                    </td>
                    <td>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 }}>
          <section className={s.panel}>
            <h2>Контакты</h2>
            <p>
              <a className={s.link} href={`tel:${d.phone}`}>
                {d.phone}
              </a>
              <br />
              Удобно: {PREMIUM_CONTACTS[d.contact]}
              {d.contact === 'whatsapp' && (
                <>
                  {' '}
                  ·{' '}
                  <a className={s.link} href={`https://wa.me/${d.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                    открыть WhatsApp
                  </a>
                </>
              )}
            </p>
            <p className={s.muted}>{d.userEmail ? `Аккаунт: ${d.userEmail}` : 'Гость, без аккаунта'}</p>
          </section>
          <section className={s.panel}>
            <h2>Обработка</h2>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className={s.muted}>Статус</span>
              <select className={s.input} value={status} onChange={(e) => setStatus(e.target.value as PremiumLeadStatus)}>
                {Object.entries(PREMIUM_LEAD_STATUSES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              <span className={s.muted}>Комментарий менеджера</span>
              <textarea className={s.input} rows={5} style={{ width: '100%', font: 'inherit' }} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
            </label>
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={busy}
                onClick={async () => {
                  setMsg(null);
                  setBusy(true);
                  try {
                    apply(await api<View>(`/admin/premium/${id}`, { status, managerComment: comment }, 'PUT'));
                    setMsg({ tone: 'success', text: 'Сохранено' });
                  } catch (e) {
                    setMsg({ tone: 'error', text: isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером' });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Сохранить
              </Button>
            </div>
            <p className={s.muted}>Обновлено {date(d.updatedAt)}. Изменения пишутся в журнал действий.</p>
          </section>
        </div>
      </div>
    </>
  );
}
