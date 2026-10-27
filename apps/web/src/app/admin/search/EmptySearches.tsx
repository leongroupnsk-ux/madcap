'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Row = { query: string; count: number; firstAt: string; lastAt: string };
type Data = { since: string; total: number; items: Row[] };

const PERIODS = [
  [1, 'сутки'],
  [7, '7 дней'],
  [30, '30 дней'],
  [90, '90 дней'],
  [365, 'год'],
] as const;
const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Поиск без результатов (раздел «Справочники и витрина»): какие запросы покупателей витрина не нашла — подсказка,
 * каких товаров, синонимов или опечаток не хватает. Сортировка: чаще и свежее — выше.
 */
export function EmptySearches() {
  const [days, setDays] = useState(30);
  const [q, setQ] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Data>(`/admin/search/empty?days=${days}&limit=200${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(isApiError(e) ? e.message : 'Нет связи с сервером'));
    }, 250);
    return () => clearTimeout(t);
  }, [days, q]);

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Справочники и витрина</div>
          <h1>Поиск без результатов</h1>
          <div className={s.muted}>Запросы, по которым витрина ничего не нашла. Без персональных данных: только текст запроса и счётчик.</div>
        </div>
      </div>
      <div className={s.filters}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className={s.muted}>Период</span>
          <select className={s.input} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map(([d, l]) => (
              <option key={d} value={d}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 240px' }}>
          <span className={s.muted}>Поиск по запросу</span>
          <input className={s.input} type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="например, пижама" />
        </label>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <section className={s.panel}>
        <p className={s.muted} aria-live="polite" style={{ marginTop: 0 }}>
          {data ? `Запросов: ${data.total}${data.total > data.items.length ? ` (показаны первые ${data.items.length})` : ''} · с ${date(data.since)}` : 'Загружаем…'}
        </p>
        {data && data.items.length > 0 && (
          <div className={s.scroll} tabIndex={0} role="region" aria-label="Пустые запросы, таблица">
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Запрос</th>
                  <th scope="col">Сколько раз</th>
                  <th scope="col">Первый раз</th>
                  <th scope="col">Последний раз</th>
                  <th scope="col">
                    <span className="visually-hidden">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.query}>
                    <td>{r.query}</td>
                    <td>{r.count}</td>
                    <td>{date(r.firstAt)}</td>
                    <td>{date(r.lastAt)}</td>
                    <td>
                      <Link className={s.link} href={`/catalog?q=${encodeURIComponent(r.query)}`} target="_blank" aria-label={`Открыть в каталоге: ${r.query}`}>
                        открыть в каталоге
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && !data.items.length && <p>За этот период пустых запросов нет.</p>}
      </section>
    </>
  );
}
