'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { FileIcon } from '@/components/supplier/FileIcon';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { ImportJob } from '@/lib/types';
import i from './import.module.css';

const RUNNING = new Set(['queued', 'checking', 'applying']);
const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function ImportScreen({ feedUrl, initialJobs }: { feedUrl: string | null; initialJobs: ImportJob[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [current, setCurrent] = useState<ImportJob | null>(initialJobs.find((j) => j.source === 'file') ?? null);
  const [feed, setFeed] = useState(feedUrl ?? '');
  const [savedFeed, setSavedFeed] = useState(feedUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const list = await api<ImportJob[]>('/supplier/import');
    setJobs(list);
    if (current) setCurrent(await api<ImportJob>(`/supplier/import/${current.id}`));
  }, [current]);

  // Пока задача в работе — опрашиваем раз в 2 секунды.
  const running = jobs.some((j) => RUNNING.has(j.status)) || (current && RUNNING.has(current.status));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [running, refresh]);
  useEffect(() => {
    if (current && !current.errors.length && current.errorRows) void api<ImportJob>(`/supplier/import/${current.id}`).then(setCurrent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
    } finally {
      setBusy(null);
    }
  }

  const lastFeed = jobs.find((j) => j.source === 'yml');

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Каталог поставщика</div>
          <h1>Импорт товаров</h1>
          <p className={s.lead}>Три способа держать каталог актуальным — карточки, цены и остатки создаются и обновляются по SKU.</p>
        </div>
      </div>
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className={i.cards}>
        <section className={i.card}>
          <div className={i.cardTop}>
            <FileIcon />
          </div>
          <b className={i.cardTitle}>Файл по шаблону</b>
          <p className={i.cardText}>XLSX или CSV: строка = SKU (размер) + остаток + цена, фото — ссылками.</p>
          <div className={i.cardActions}>
            <button type="button" className={i.btn} disabled={!!busy} onClick={() => fileInput.current?.click()}>
              {busy === 'upload' ? 'Загружаем…' : 'Загрузить файл'}
            </button>
            <a href="/api/supplier/import/template.xlsx" className={i.textBtn}>
              Скачать шаблон
            </a>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void act('upload', async () => {
                const form = new FormData();
                form.append('file', file);
                const job = await api<ImportJob>('/supplier/import/file', form);
                setCurrent(job);
                setJobs([job, ...jobs]);
              });
            }}
          />
        </section>

        <section className={`${i.card} ${savedFeed ? i.cardActive : ''}`}>
          <div className={i.cardTop}>
            <FileIcon />
            {savedFeed && <span className={`${i.tag} ${i.tagOk}`}>Подключён</span>}
          </div>
          <b className={i.cardTitle}>Выгрузка из вашей системы</b>
          <p className={i.cardText}>YML-файл из 1С, МойСклад или inSales — по ссылке. Синк каждые 6 часов.</p>
          <input className={i.url} value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="https://shop.ru/export/yml_feed.xml" aria-label="Ссылка на YML-фид" />
          <div className={i.feedFoot}>
            <span className={`${i.sync} ${lastFeed?.status === 'failed' ? i.syncFail : lastFeed ? '' : i.syncNone}`}>
              {lastFeed ? `Последний синк: ${fmt(lastFeed.createdAt)} · ${lastFeed.status === 'failed' ? 'ошибка' : RUNNING.has(lastFeed.status) ? 'идёт' : 'ок'}` : 'Синхронизаций ещё не было'}
            </span>
            {feed.trim() !== (savedFeed ?? '') ? (
              <button
                type="button"
                className={i.textBtn}
                disabled={!!busy}
                onClick={() =>
                  act('feed', async () => {
                    const url = feed.trim() || null;
                    const job = await api<ImportJob | null>('/supplier/import/feed', { url }, 'PUT');
                    setSavedFeed(url);
                    if (job) setJobs([job, ...jobs]);
                  })
                }
              >
                {feed.trim() ? 'Сохранить и синхронизировать' : 'Отключить фид'}
              </button>
            ) : (
              savedFeed && (
                <button
                  type="button"
                  className={i.textBtn}
                  disabled={!!busy}
                  onClick={() =>
                    act('sync', async () => {
                      const job = await api<ImportJob>('/supplier/import/feed/sync', {});
                      setJobs([job, ...jobs.filter((j) => j.id !== job.id)]);
                    })
                  }
                >
                  {busy === 'sync' ? 'Запускаем…' : 'Синхронизировать'}
                </button>
              )
            )}
          </div>
        </section>

        <section className={`${i.card} ${i.cardSoon}`}>
          <div className={i.cardTop}>
            <FileIcon muted />
            <span className={i.tag}>Скоро</span>
          </div>
          <b className={i.cardTitle}>API-интеграция</b>
          <p className={i.cardText}>Остатки и цены в реальном времени из вашей системы. Этап 2.</p>
          <a className={i.soonBtn} href="mailto:partners@example.ru?subject=API-интеграция">
            Оставить заявку
          </a>
        </section>
      </div>

      {current && (
        <section className={`${s.panel} ${s.panelPad}`} style={{ marginTop: 32 }}>
          <div className={i.lastHead}>
            <h2>Последний импорт · {current.fileName}</h2>
            <Badge status={current.status}>{current.status === 'checked' ? 'Превью' : undefined}</Badge>
          </div>
          {current.status === 'failed' && (
            <div style={{ marginTop: 16 }}>
              <Alert tone="error">{current.failReason}</Alert>
            </div>
          )}
          {RUNNING.has(current.status) && <p className={s.muted} style={{ marginTop: 16 }}>{current.status === 'applying' ? 'Записываем товары…' : 'Проверяем файл…'}</p>}
          {(current.status === 'checked' || current.status === 'applied') && (
            <>
              <div className={i.counters}>
                <div className={i.counter}>
                  <b>{current.totalRows}</b>строк в файле
                </div>
                <div className={`${i.counter} ${i.cNew}`}>
                  <b>{current.newProducts}</b>новых товаров
                </div>
                <div className={`${i.counter} ${i.cUpd}`}>
                  <b>{current.updates}</b>обновлений цен/остатков
                </div>
                <div className={`${i.counter} ${current.errorRows ? i.cErr : ''}`}>
                  <b>{current.errorRows}</b>строк с ошибками
                </div>
              </div>
              {current.errors.length > 0 && (
                <div className={i.errors}>
                  <div className={i.errorsTitle}>Примеры ошибок{current.errorRows > 0 ? ' (полный отчёт — файлом)' : ''}</div>
                  {current.errors.slice(0, 5).map((e, n) => (
                    <div key={n}>
                      {e.row ? `стр. ${e.row} — ` : ''}
                      <span className={i.errField}>{e.field}</span>: {e.message}
                    </div>
                  ))}
                </div>
              )}
              <div className={i.applyRow}>
                <span className={i.applyActions}>
                  {current.status === 'checked' && current.totalRows - current.errorRows > 0 && (
                    <Button
                      className={i.applyBtn}
                      disabled={!!busy}
                      onClick={() =>
                        act('apply', async () => {
                          setCurrent(await api<ImportJob>(`/supplier/import/${current.id}/apply`, {}));
                        })
                      }
                    >
                      Применить {current.totalRows - current.errorRows} строк
                    </Button>
                  )}
                  {current.errorRows > 0 && (
                    <a className={i.reportLink} href={`/api/supplier/import/${current.id}/errors.csv`}>
                      Скачать отчёт об ошибках
                    </a>
                  )}
                </span>
                <span className={i.applyNote}>новые товары уйдут на модерацию · ~24 ч</span>
              </div>
            </>
          )}
        </section>
      )}

      <section className={`${s.panel} ${s.panelPad}`} style={{ marginTop: 32 }}>
        <h2>История импортов</h2>
        <div className={`${s.tableCard} ${s.tableCardSm}`} style={{ marginTop: 16 }}>
          <table className={`${s.table} ${i.history}`}>
            <thead>
              <tr>
                <th>Источник</th>
                <th>Дата</th>
                <th>Строк</th>
                <th>Результат</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} onClick={() => j.source === 'file' && void api<ImportJob>(`/supplier/import/${j.id}`).then(setCurrent)} style={{ cursor: j.source === 'file' ? 'pointer' : undefined }}>
                  <td className={s.semi}>{j.source === 'yml' ? 'YML-фид · автосинк' : j.fileName}</td>
                  <td className={i.dim}>{fmt(j.createdAt)}</td>
                  <td className={i.dim}>{j.totalRows ? j.totalRows.toLocaleString('ru-RU') : '—'}</td>
                  <td className={i.dim}>{j.status === 'failed' ? j.failReason : j.status === 'checked' ? 'ждёт применения' : `${j.newProducts} новых · ${j.updates} обновлений`}</td>
                  <td className={i.mono}>
                    <Badge status={j.status}>{j.status === 'checked' ? 'Превью' : undefined}</Badge>
                  </td>
                </tr>
              ))}
              {!jobs.length && (
                <tr>
                  <td colSpan={5} className={s.muted}>
                    Импортов ещё не было.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
