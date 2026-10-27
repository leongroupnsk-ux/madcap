import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import s from '@/components/supplier/cabinet.module.css';
import { Alert } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import d from './dashboard.module.css';
import { RefreshButton } from './RefreshButton';

export const metadata = { title: 'Дашборд платформы' };

type Period = { gmv: number; commission: number; orders: number; avgCheck: number };
type Day = { day: string; gmv: number; commission: number; orders: number };
type ModRow = { kind: string; label: string; decided: number; medianHours: number | null; p90Hours: number | null; overSla: number; pendingOverSla: number };
type Dashboard = {
  computedAt: string;
  cacheSeconds: number;
  periods: { today: Period; week: Period; month: Period };
  days: Day[];
  funnel: { quizStarted: number; quizCompleted: number; capsulesBuilt: number; capsuleToCart: number | null; orders: number; capsuleOrders: number; capsuleShare: number };
  moderation: { slaHours: number; rows: ModRow[] };
  queues: Record<'problemOrders' | 'unconfirmed' | 'applications' | 'moderationProducts' | 'moderationContent' | 'moderationReviews' | 'premium' | 'returns', number>;
};

const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('ru-RU', { ...opts, timeZone: 'UTC' });
const hours = (h: number | null) => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} мин` : `${h.toLocaleString('ru-RU')} ч`);

/** Округление шкалы вверх до «красивого» числа рублей: 1, 2, 5 × 10ⁿ */
function niceMax(v: number) {
  if (v <= 0) return 100000;
  const rub = v / 100;
  const p = 10 ** Math.floor(Math.log10(rub));
  const m = [1, 2, 5, 10].find((x) => x * p >= rub)!;
  return m * p * 100;
}

/**
 * График GMV по дням (30 московских дней). SVG — одна серия, одна ось. Для скринридера — описание
 * в role="img" и таблица значений (визуально скрыта; зрячим значения дня — во всплывающей подсказке столбца).
 */
function GmvChart({ days }: { days: Day[] }) {
  const W = 900;
  const H = 240;
  const pad = { l: 64, r: 8, t: 12, b: 28 };
  const max = niceMax(Math.max(...days.map((x) => x.gmv)));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const step = iw / days.length;
  const bw = Math.max(4, step - 4);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.5, 1].map((k) => k * max);
  const total = days.reduce((a, x) => a + x.gmv, 0);
  const best = days.reduce((a, x) => (x.gmv > a.gmv ? x : a), days[0]);
  return (
    <figure className={d.chart} aria-labelledby="gmv-caption">
      <figcaption id="gmv-caption" className={s.muted} style={{ marginBottom: 8 }}>
        Сумма товаров оплаченных заказов по дням за 30 дней, ₽. Наведите на столбец — значения дня.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`GMV по дням: всего ${formatRub(total)} за 30 дней, максимум ${formatRub(best.gmv)} — ${dayLabel(best.day)}. Значения — в таблице ниже.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={d.gridLine} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className={d.axis} x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {formatRub(t)}
            </text>
          </g>
        ))}
        {days.map((x, i) => {
          const h = Math.max(x.gmv ? 2 : 0, (x.gmv / max) * ih);
          const bx = pad.l + i * step + (step - bw) / 2;
          const tip = `${dayLabel(x.day, { day: 'numeric', month: 'long' })}: GMV ${formatRub(x.gmv)}, комиссия ${formatRub(x.commission)}, ${x.orders} ${plural(x.orders, 'заказ', 'заказа', 'заказов')}`;
          return (
            <g key={x.day}>
              {/* Зона наведения шире столбца — подсказку легко поймать и у дня без продаж */}
              <rect className={d.hit} x={pad.l + i * step} y={pad.t} width={step} height={ih}>
                <title>{tip}</title>
              </rect>
              {h > 0 && <rect className={d.bar} x={bx} y={y(0) - h} width={bw} height={h} rx={Math.min(4, bw / 2)} pointerEvents="none" />}
              {(i % 5 === 0 || i === days.length - 1) && (
                <text className={d.axis} x={pad.l + i * step + step / 2} y={H - 8} textAnchor="middle">
                  {dayLabel(x.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="visually-hidden">
        <caption>GMV, комиссия и число заказов по дням</caption>
        <thead>
          <tr>
            <th scope="col">День</th>
            <th scope="col">GMV</th>
            <th scope="col">Комиссия</th>
            <th scope="col">Заказов</th>
          </tr>
        </thead>
        <tbody>
          {days.map((x) => (
            <tr key={x.day}>
              <th scope="row">{dayLabel(x.day, { day: 'numeric', month: 'long' })}</th>
              <td>{formatRub(x.gmv)}</td>
              <td>{formatRub(x.commission)}</td>
              <td>{x.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function PeriodTile({ label, p }: { label: string; p: Period }) {
  return (
    <div className={d.tile}>
      <span className={d.tileLabel}>{label}</span>
      <b>{formatRub(p.gmv)}</b>
      <span className={d.tileHint}>
        выручка платформы {formatRub(p.commission)} · {p.orders} {plural(p.orders, 'заказ', 'заказа', 'заказов')}
        {p.orders ? ` · средний чек ${formatRub(p.avgCheck)}` : ''}
      </span>
    </div>
  );
}

/** Дашборд платформы (ТЗ §8) — стартовая страница админки владельца и поддержки */
export default async function AdminDashboardPage() {
  const { data, status } = await serverApi<Dashboard>('/admin/dashboard');
  if (!data) {
    return (
      <>
        <div className={s.head}>
          <h1>Дашборд платформы</h1>
        </div>
        <Alert tone="error">{status === 403 ? 'Раздел недоступен для вашей роли' : 'Не удалось загрузить данные — обновите страницу'}</Alert>
      </>
    );
  }
  const f = data.funnel;
  const q = data.queues;
  const steps: [string, number | null][] = [
    ['Начали анкету', f.quizStarted],
    ['Прошли анкету', f.quizCompleted],
    ['Капсула собрана', f.capsulesBuilt],
    ['Капсула в корзину', f.capsuleToCart],
    ['Оплаченных заказов', f.orders],
  ];
  const top = Math.max(1, ...steps.map(([, v]) => v ?? 0));
  const queues: [string, number, string, boolean][] = [
    ['Заказы с проблемами', q.problemOrders, '/admin/orders?status=problem', q.problemOrders > 0],
    ['Не подтверждены > 24 ч', q.unconfirmed, '/admin/orders?status=problem', q.unconfirmed > 0],
    ['Возвраты на рассмотрении', q.returns, '/admin/orders?status=problem', false],
    ['Заявки поставщиков', q.applications, '/admin/applications', false],
    ['Модерация товаров', q.moderationProducts, '/admin/moderation', false],
    ['Модерация контента', q.moderationContent, '/admin/content', false],
    ['Модерация отзывов', q.moderationReviews, '/admin/reviews', false],
    ['Премиум-заявки «новые»', q.premium, '/admin/premium', q.premium > 0],
  ];
  const computed = new Date(data.computedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Дашборд платформы</h1>
          <div className={s.muted}>
            Данные на {computed} МСК, обновляются раз в {data.cacheSeconds / 60} минут. Сутки — по Москве.
          </div>
        </div>
        <RefreshButton />
      </div>

      <div className={d.periods}>
        <PeriodTile label="Сегодня" p={data.periods.today} />
        <PeriodTile label="7 дней" p={data.periods.week} />
        <PeriodTile label="30 дней" p={data.periods.month} />
      </div>

      <section className={s.panel}>
        <h2>GMV по дням</h2>
        <GmvChart days={data.days} />
        <p className={s.muted} style={{ marginTop: 8 }}>
          GMV — сумма товаров в оплаченных заказах без отменённых отправлений (возвраты после доставки не вычитаются). Выручка платформы — комиссия по этим же отправлениям.
        </p>
      </section>

      <section className={s.panel} style={{ marginTop: 16 }}>
        <h2>Требуют внимания</h2>
        <div className={d.queues}>
          {queues.map(([label, n, href, hot]) => (
            <Link key={label} href={href} className={`${d.queue} ${hot ? d.queueHot : ''}`}>
              <span className={d.tileLabel}>{label}</span>
              <b>{n}</b>
            </Link>
          ))}
        </div>
      </section>

      <div className={d.two}>
        <section className={s.panel}>
          <h2>Воронка подбора, 30 дней</h2>
          <ol className={d.funnel}>
            {steps.map(([label, v]) => (
              <li key={label}>
                <div className={d.funnelRow}>
                  <span>{label}</span>
                  {v == null ? <span className={d.skipped}>не измеряется</span> : <b>{v}</b>}
                </div>
                {v != null && (
                  <div className={d.meter} aria-hidden="true">
                    <span style={{ width: `${(v / top) * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className={s.muted} style={{ marginTop: 12 }}>
            Заказов с вещами из капсулы: {f.capsuleOrders} из {f.orders} ({f.capsuleShare.toLocaleString('ru-RU')}%). «Капсула в корзину» пропущено: событие не пишется — корзина гостя живёт в браузере.
          </p>
        </section>

        <section className={s.panel}>
          <h2>Сроки модерации, 30 дней</h2>
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Очередь</th>
                  <th scope="col">Решений</th>
                  <th scope="col">Медиана</th>
                  <th scope="col">90%</th>
                  <th scope="col">Ждут &gt; {data.moderation.slaHours} ч</th>
                </tr>
              </thead>
              <tbody>
                {data.moderation.rows.map((r) => {
                  const late = (r.p90Hours ?? 0) > data.moderation.slaHours;
                  return (
                    <tr key={r.kind}>
                      <th scope="row" className={d.rowHead} style={{ fontWeight: r.kind === 'all' ? 700 : 400 }}>
                        {r.label}
                      </th>
                      <td>{r.decided}</td>
                      <td>{hours(r.medianHours)}</td>
                      <td className={late ? d.warn : undefined}>
                        {hours(r.p90Hours)}
                        {late && <span> · выше SLA</span>}
                      </td>
                      <td className={r.pendingOverSla ? d.warn : undefined}>{r.pendingOverSla}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={s.muted} style={{ marginTop: 12 }}>
            От отправки на модерацию до решения. SLA — {data.moderation.slaHours} ч (ТЗ §8); превышение отмечено красным и словом «выше SLA».
          </p>
        </section>
      </div>
    </>
  );
}
