'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import a from './analytics.module.css';

type Day = { day: string; revenue: number; units: number; orders: number };
type CapsuleRow = { productId: string; slug: string; title: string; hits: number; zeroHits: number; stock: number };
export type AnalyticsData = {
  days: number;
  from: string;
  to: string;
  totals: { revenue: number; units: number; orders: number; avgOrder: number; returnedUnits: number; returnedSum: number; returnRate: number };
  series: Day[];
  top: { productId: string | null; slug: string | null; title: string; units: number; revenue: number; returned: number }[];
  funnel: { viewsTracked: boolean; views: number; cartAdds: number; orderLines: number; orders: number };
  capsules: CapsuleRow[];
  zeroInCapsules: CapsuleRow[];
};

type Metric = 'revenue' | 'units';
const pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('ru-RU')}%`;
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00+03:00`).toLocaleDateString('ru-RU', { ...opts, timeZone: 'Europe/Moscow' });
const valueLabel = (m: Metric, v: number) => (m === 'revenue' ? formatRub(v) : `${v.toLocaleString('ru-RU')} шт.`);

/** Округлённый шаг оси: 1, 2, 5 × 10^n */
function niceStep(max: number, ticks = 4) {
  const raw = Math.max(max, 1) / ticks;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((x) => x >= raw)!;
}
/** Короткая подпись оси: «12 тыс ₽» */
function axisLabel(m: Metric, v: number) {
  if (m === 'units') return v.toLocaleString('ru-RU');
  const rub = v / 100;
  if (rub >= 1_000_000) return `${(rub / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽`;
  if (rub >= 1000) return `${(rub / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс ₽`;
  return `${rub.toLocaleString('ru-RU')} ₽`;
}

/** Столбики по дням (SVG). Для скринридера — таблица с теми же данными, сам рисунок скрыт от него. */
function DailyChart({ series, metric }: { series: Day[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 260;
  const L = 72;
  const R = 8;
  const T = 12;
  const B = 28;
  const pw = W - L - R;
  const ph = H - T - B;
  const values = series.map((d) => d[metric]);
  const step = niceStep(Math.max(...values, 0));
  const top = step * Math.max(1, Math.ceil(Math.max(...values, 0) / step));
  const slot = pw / series.length;
  const bw = Math.max(2, slot - 2);
  const every = series.length <= 30 ? 5 : 15;
  const y = (v: number) => T + ph - (v / top) * ph;
  const h = hover !== null ? series[hover] : null;
  return (
    <div className={a.chartWrap} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className={a.chart} aria-hidden="true" focusable="false">
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? a.axis : a.grid} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className={a.tick}>
              {axisLabel(metric, v)}
            </text>
          </g>
        ))}
        {series.map((d, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          const v = d[metric];
          const bh = (v / top) * ph;
          const r = Math.min(4, bw / 2, bh);
          const yt = T + ph - bh;
          return (
            <g key={d.day}>
              {v > 0 && (
                <path
                  className={hover === i ? `${a.bar} ${a.barActive}` : a.bar}
                  d={`M${x},${T + ph} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${T + ph} Z`}
                />
              )}
              {i % every === (series.length - 1) % every && (
                <text x={i === series.length - 1 ? x + bw : x + bw / 2} y={H - 8} textAnchor={i === series.length - 1 ? 'end' : 'middle'} className={a.tick}>
                  {dayLabel(d.day)}
                </text>
              )}
              {/* Зона наведения шире столбика — на всю высоту и ширину дня */}
              <rect x={L + i * slot} y={T} width={slot} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className={a.tooltip} style={{ left: `${((L + (hover + 0.5) * slot) / W) * 100}%` }} aria-hidden="true">
          <b>{dayLabel(h.day, { day: 'numeric', month: 'long', weekday: 'short' })}</b>
          <span>{formatRub(h.revenue)}</span>
          <span>
            {h.units} шт. · {h.orders} {plural(h.orders, 'заказ', 'заказа', 'заказов')}
          </span>
        </div>
      )}
    </div>
  );
}

function CapsuleTable({ rows, caption, zero }: { rows: CapsuleRow[]; caption: string; zero?: boolean }) {
  return (
    <div className={`${s.tableCard} ${s.tableCardSm}`}>
      <table className={`${s.table} ${a.table}`}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Товар</th>
            <th scope="col" className={a.num}>
              {zero ? 'Без остатка в капсулах' : 'В капсулах'}
            </th>
            <th scope="col" className={a.num}>
              Остаток, шт.
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId}>
              <td>
                <Link href={`/supplier/products/${r.productId}`} className={s.link}>
                  {r.title}
                </Link>
              </td>
              <td className={a.num}>{zero ? `${r.zeroHits} из ${r.hits}` : r.hits}</td>
              <td className={`${a.num} ${r.stock === 0 ? a.warn : ''}`}>{r.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Экран «Аналитика»: метрики периода, график по дням, воронка, топ товаров, капсулы */
export function Analytics({ data, days }: { data: AnalyticsData | null; days: 30 | 90 }) {
  const [metric, setMetric] = useState<Metric>('revenue');
  if (!data)
    return (
      <div className={s.head}>
        <div>
          <h1>Аналитика продаж</h1>
          <p className={s.lead}>Не удалось загрузить данные — обновите страницу.</p>
        </div>
      </div>
    );
  const t = data.totals;
  const f = data.funnel;
  const steps = [
    ...(f.viewsTracked ? [{ label: 'Просмотры карточек', value: f.views }] : []),
    { label: 'Добавления в корзину', value: f.cartAdds },
    { label: 'Позиции в заказах', value: f.orderLines },
  ];
  const period = `${dayLabel(data.from, { day: 'numeric', month: 'long' })} — ${dayLabel(data.to, { day: 'numeric', month: 'long' })}`;
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Аналитика</div>
          <h1>Аналитика продаж</h1>
          <p className={s.lead}>
            {period}. Продажа — оплаченное отправление, кроме отменённых; выручка — по цене продажи, до комиссии и возвратов.
          </p>
        </div>
        <nav className={a.periods} aria-label="Период">
          {([30, 90] as const).map((d) => (
            <Link key={d} href={`/supplier/analytics${d === 90 ? '?days=90' : ''}`} className={d === days ? a.periodOn : a.period} aria-current={d === days ? 'page' : undefined}>
              {d} дней
            </Link>
          ))}
        </nav>
      </div>

      <div className={s.tiles}>
        <div className={s.tile}>
          <span className={s.tileLabel}>Выручка</span>
          <b>{formatRub(t.revenue)}</b>
          <span className={s.tileHint}>средний заказ {formatRub(t.avgOrder)}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileLabel}>Продано</span>
          <b>{t.units.toLocaleString('ru-RU')} шт.</b>
          <span className={s.tileHint}>
            {t.orders} {plural(t.orders, 'отправление', 'отправления', 'отправлений')}
          </span>
        </div>
        <div className={s.tile}>
          <span className={s.tileLabel}>Доля возвратов</span>
          <b>{pct(t.returnRate)}</b>
          <span className={`${s.tileHint} ${t.returnRate > 0.15 ? s.tileWarn : ''}`}>
            {t.returnedUnits} шт. на {formatRub(t.returnedSum)}
          </span>
        </div>
        <div className={s.tile}>
          <span className={s.tileLabel}>Корзина → заказ</span>
          <b>{f.cartAdds ? pct(Math.min(1, f.orderLines / f.cartAdds)) : '—'}</b>
          <span className={s.tileHint}>{f.cartAdds ? `в заказах ${f.orderLines} · добавлений ${f.cartAdds}` : 'добавлений в корзину пока нет'}</span>
        </div>
      </div>

      <section className={`${s.panel} ${s.panelPad}`} aria-labelledby="chart-title">
        <div className={s.panelHead}>
          <h2 id="chart-title">По дням</h2>
          <div className={a.toggle} role="group" aria-label="Показатель на графике">
            {(
              [
                ['revenue', 'Выручка'],
                ['units', 'Штуки'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} type="button" aria-pressed={metric === m} className={metric === m ? a.toggleOn : a.toggleBtn} onClick={() => setMetric(m)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <DailyChart series={data.series} metric={metric} />
        <table className="visually-hidden">
          <caption>Продажи по дням за {days} дней</caption>
          <thead>
            <tr>
              <th scope="col">День</th>
              <th scope="col">Выручка</th>
              <th scope="col">Продано, шт.</th>
              <th scope="col">Отправлений</th>
            </tr>
          </thead>
          <tbody>
            {data.series.map((d) => (
              <tr key={d.day}>
                <th scope="row">{dayLabel(d.day, { day: 'numeric', month: 'long' })}</th>
                <td>{valueLabel('revenue', d.revenue)}</td>
                <td>{d.units}</td>
                <td>{d.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className={a.grid2}>
        <section className={`${s.panel} ${s.panelPad}`} aria-labelledby="funnel-title">
          <h2 id="funnel-title" className={a.h2}>
            Воронка
          </h2>
          {!f.viewsTracked && <p className={s.muted}>Просмотров карточек пока нет в данных — воронка начинается с корзины.</p>}
          <ol className={a.funnel}>
            {steps.map((st, i) => {
              const prev = i ? steps[i - 1].value : 0;
              const max = Math.max(...steps.map((x) => x.value), 1);
              return (
                <li key={st.label}>
                  <div className={a.funnelRow}>
                    <span>{st.label}</span>
                    <b>{st.value.toLocaleString('ru-RU')}</b>
                  </div>
                  <div className={a.funnelTrack} aria-hidden="true">
                    <div className={a.funnelBar} style={{ width: `${(st.value / max) * 100}%` }} />
                  </div>
                  {i > 0 && <div className={a.funnelConv}>{prev ? `конверсия ${pct(Math.min(1, st.value / prev))}` : 'конверсия —'}</div>}
                </li>
              );
            })}
          </ol>
          <p className={a.note}>Корзина гостя хранится в браузере и учитывается, когда покупатель входит в аккаунт.</p>
        </section>

        <section className={`${s.panel} ${s.panelPad}`} aria-labelledby="top-title">
          <h2 id="top-title" className={a.h2}>
            Топ товаров
          </h2>
          {data.top.length ? (
            <div className={`${s.tableCard} ${s.tableCardSm}`}>
              <table className={`${s.table} ${a.table}`}>
                <caption className="visually-hidden">Топ товаров по выручке за {days} дней</caption>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col" className={a.num}>
                      Шт.
                    </th>
                    <th scope="col" className={a.num}>
                      Выручка
                    </th>
                    <th scope="col" className={a.num}>
                      Возвраты
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((r) => (
                    <tr key={r.productId ?? r.title}>
                      <td>
                        {r.productId ? (
                          <Link href={`/supplier/products/${r.productId}`} className={s.link}>
                            {r.title}
                          </Link>
                        ) : (
                          r.title
                        )}
                      </td>
                      <td className={a.num}>{r.units}</td>
                      <td className={`${a.num} ${s.nowrap}`}>{formatRub(r.revenue)}</td>
                      <td className={a.num}>{r.units ? pct(r.returned / r.units) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={s.muted}>Продаж за период пока нет.</p>
          )}
        </section>
      </div>

      <div className={a.grid2}>
        <section className={`${s.panel} ${s.panelPad}`} aria-labelledby="caps-title">
          <h2 id="caps-title" className={a.h2}>
            Чаще всего в капсулах
          </h2>
          <p className={s.muted}>В скольких капсулах покупателей товар стоит сейчас.</p>
          {data.capsules.length ? <CapsuleTable rows={data.capsules} caption="Товары, которые чаще всего попадают в капсулы" /> : <p className={s.muted}>Ваших товаров в капсулах пока нет.</p>}
        </section>
        <section className={`${s.panel} ${s.panelPad}`} aria-labelledby="zero-title">
          <h2 id="zero-title" className={a.h2}>
            Нет в наличии, но в капсулах
          </h2>
          <p className={s.muted}>У выбранного в капсуле варианта нулевой остаток — покупатель не может его купить. Пополните остаток.</p>
          {data.zeroInCapsules.length ? <CapsuleTable zero rows={data.zeroInCapsules} caption="Товары с нулевым остатком в капсулах" /> : <p className={s.muted}>Таких товаров нет.</p>}
        </section>
      </div>
    </>
  );
}
