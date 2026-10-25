'use client';

import { useCallback, useState } from 'react';
import { useEscape } from '@/components/ui';
import type { ProductDetails } from '@/lib/catalog';
import p from './product.module.css';

type Kind = 'clothes' | 'shoes';
type Chart = ProductDetails['sizeChart'][Kind];

function Table({ chart }: { chart: Chart }) {
  return (
    <table className={p.chart}>
      <thead>
        <tr>
          {chart.columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chart.rows.map((r) => (
          <tr key={r.join()}>
            {r.map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Узкую длинную таблицу (обувь) макет показывает в две половины рядом — с жирной чертой посередине. */
function SplitTable({ chart }: { chart: Chart }) {
  const half = Math.ceil(chart.rows.length / 2);
  const n = chart.columns.length;
  return (
    <table className={`${p.chart} ${p.chartSplit}`}>
      <thead>
        <tr>
          {[...chart.columns, ...chart.columns].map((c, i) => (
            <th key={i} className={i === n ? p.chartMid : undefined}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chart.rows.slice(0, half).map((r, k) => {
          const right = chart.rows[half + k] ?? Array<string>(n).fill('');
          return (
            <tr key={r.join()}>
              {[...r, ...right].map((c, i) => (
                <td key={i} className={i === n ? p.chartMid : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Окно «Таблица размеров» (кадры table-of-sizes и table-of-sizes-shoes): вкладки «Одежда» / «Обувь», таблица бренда из справочника. */
export function SizeChart({ chart, initial, onClose }: { chart: ProductDetails['sizeChart']; initial: Kind; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>(initial);
  const close = useCallback(() => onClose(), [onClose]);
  useEscape(close);
  const cur = chart[kind];
  const split = cur.columns.length <= 3 && cur.rows.length >= 8;
  return (
    <div className={p.chartOverlay} onClick={close}>
      <div className={p.chartModal} role="dialog" aria-modal="true" aria-label="Таблица размеров" onClick={(e) => e.stopPropagation()}>
        <div className={p.chartHead}>
          <div>
            <div className="eyebrow">Информация</div>
            <h2>Таблица размеров</h2>
          </div>
          <button type="button" className={p.chartClose} onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className={p.tabs} role="tablist">
          {(['clothes', 'shoes'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={`${p.tab} ${kind === k ? p.tabOn : ''}`} onClick={() => setKind(k)}>
              {k === 'clothes' ? 'Одежда' : 'Обувь'}
            </button>
          ))}
          <span className={p.tabRest} />
        </div>
        <div className={p.chartWrap}>
          {split ? (
            <>
              <div className={p.onlyWide}>
                <SplitTable chart={cur} />
              </div>
              <div className={p.onlyNarrow}>
                <Table chart={cur} />
              </div>
            </>
          ) : (
            <Table chart={cur} />
          )}
        </div>
      </div>
    </div>
  );
}
