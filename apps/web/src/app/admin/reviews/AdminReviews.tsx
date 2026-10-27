'use client';

import { REVIEW_FIT_LABEL } from '@aesculap/shared';
import { useCallback, useEffect, useState } from 'react';
import { Stars } from '@/components/shop/Stars';
import { Badge } from '@/components/admin/Badge';
import s from '@/components/admin/admin.module.css';
import { Alert, Button, Chip, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Status = 'pending' | 'approved' | 'rejected';
type Item = {
  id: string; product: { slug: string; title: string }; supplier: string; author: string; rating: number; fit: 'small' | 'true_to_size' | 'large'; text: string;
  photos: { url: string | null }[]; status: Status; rejectReason: string | null; reply: string | null; createdAt: string; updatedAt: string;
};
type Queue = { counts: Partial<Record<Status, number>>; items: Item[] };

const TABS: [Status, string][] = [
  ['pending', 'В очереди'],
  ['approved', 'Опубликованы'],
  ['rejected', 'Отклонены'],
];
const when = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Отзывы в разделе модерации: одобрение публикует отзыв и сбрасывает кэш каталога, отказ — с причиной (уходит покупателю письмом) */
export function AdminReviews() {
  const [tab, setTab] = useState<Status>('pending');
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reject, setReject] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setData(await api<Queue>(`/admin/reviews?status=${tab}`));
  }, [tab]);
  useEffect(() => {
    load().catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Ошибка');
      return false;
    }
  };

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Модерация отзывов · {data?.counts.pending ?? 0}</h1>
        </div>
      </div>
      <div className={s.chips} role="group" aria-label="Статус отзывов">
        {TABS.map(([st, label]) => (
          <Chip key={st} active={tab === st} onClick={() => setTab(st)}>
            {label} · {data?.counts[st] ?? 0}
          </Chip>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div style={{ display: 'grid', gap: 12 }}>
        {data?.items.map((r) => (
          <section key={r.id} className={s.panel} aria-label={`Отзыв ${r.author} о товаре ${r.product.title}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <a className={s.link} href={`/product/${r.product.slug}`} target="_blank" rel="noreferrer">
                  {r.product.title} ↗
                </a>
                <div className={s.muted}>
                  {r.supplier} · {r.author} · {when(r.updatedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Stars value={r.rating} size={16} />
                <Badge status={r.status === 'approved' ? 'published' : r.status}>{TABS.find(([st]) => st === r.status)?.[1]}</Badge>
              </div>
            </div>
            <p style={{ margin: '12px 0 0', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{r.text}</p>
            <p className={s.muted} style={{ marginTop: 8 }}>
              Размер: {REVIEW_FIT_LABEL[r.fit].toLowerCase()}
            </p>
            {r.photos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {r.photos.map((ph, i) =>
                  ph.url ? (
                    <a key={ph.url} href={ph.url} target="_blank" rel="noreferrer" aria-label={`Фото ${i + 1} — открыть`}>
                      <img src={ph.url} alt="" width={96} height={96} style={{ objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                    </a>
                  ) : null,
                )}
              </div>
            )}
            {r.rejectReason && <p style={{ marginTop: 8, color: 'var(--c-sale)' }}>Причина отказа: {r.rejectReason}</p>}
            {r.reply && <p className={s.muted} style={{ marginTop: 8 }}>Ответ продавца: {r.reply}</p>}
            <div className={s.actions} style={{ marginTop: 16 }}>
              {r.status !== 'approved' && <Button onClick={() => run(() => api(`/admin/reviews/${r.id}/approve`, {}))}>Опубликовать</Button>}
              {r.status !== 'rejected' && (
                <Button variant="outline" onClick={() => setReject({ id: r.id, reason: '' })}>
                  {r.status === 'approved' ? 'Снять с публикации' : 'Отклонить'}
                </Button>
              )}
            </div>
          </section>
        ))}
        {data && !data.items.length && (
          <div className={`${s.tableCard} ${s.empty}`}>
            {tab === 'pending' ? 'Очередь пуста.' : 'Здесь пока ничего нет.'}
          </div>
        )}
      </div>

      {reject && (
        <Modal eyebrow="Отзыв" title="Причина отказа" onClose={() => setReject(null)}>
          <p className={s.muted} style={{ marginBottom: 12 }}>
            Покупатель получит письмо с причиной и сможет исправить отзыв.
          </p>
          <Field label="Причина" value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })} placeholder="Ссылка на другой магазин" maxLength={1000} />
          <div className={s.actions} style={{ marginTop: 14 }}>
            <Button
              disabled={reject.reason.trim().length < 3}
              onClick={async () => {
                if (await run(() => api(`/admin/reviews/${reject.id}/reject`, { reason: reject.reason.trim() }))) setReject(null);
              }}
            >
              Отклонить
            </Button>
            <Button variant="outline" onClick={() => setReject(null)}>
              Отмена
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
