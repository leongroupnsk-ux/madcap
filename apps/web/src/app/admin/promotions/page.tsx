'use client';

import { formatRub, promotionSchema } from '@aesculap/shared';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Promo = {
  id: string; name: string; description: string; badge: string; minDiscountPct: number; commissionBp: number; applyFrom: string; applyTo: string;
  startsAt: string; endsAt: string; onHomepage: boolean; newsletter: boolean; requirements: string; phase: string; applications: number; pending: number;
};
type Application = { id: string; promotion: string; minDiscountPct: number; supplier: string; product: string; discountPct: number; price: number; salePrice: number; createdAt: string };
type Form = Record<'name' | 'description' | 'badge' | 'minDiscountPct' | 'commissionPct' | 'applyFrom' | 'applyTo' | 'startsAt' | 'endsAt' | 'requirements', string> & { onHomepage: boolean; newsletter: boolean };

const PHASE: Record<string, string> = { scheduled: 'Скоро', applying: 'Приём заявок', waiting: 'Ждёт старта', running: 'Идёт', finished: 'Завершена' };
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const day = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const empty = (): Form => {
  const now = Date.now();
  return {
    name: '', description: '', badge: '', minDiscountPct: '15', commissionPct: '8', requirements: '', onHomepage: true, newsletter: false,
    applyFrom: local(new Date(now)), applyTo: local(new Date(now + 7 * 86400000)), startsAt: local(new Date(now + 8 * 86400000)), endsAt: local(new Date(now + 15 * 86400000)),
  };
};

/** Акции платформы и модерация заявок поставщиков (ТЗ §8). */
export default function AdminPromotionsPage() {
  const [list, setList] = useState<Promo[] | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [edit, setEdit] = useState<{ id?: string; form: Form } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [reject, setReject] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([api<Promo[]>('/admin/promotions'), api<Application[]>('/admin/promotions/applications')]);
    setList(p);
    setApps(a);
  }, []);
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

  const save = async () => {
    const r = promotionSchema.safeParse({ ...edit!.form });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    const body = { ...edit!.form, applyFrom: new Date(edit!.form.applyFrom), applyTo: new Date(edit!.form.applyTo), startsAt: new Date(edit!.form.startsAt), endsAt: new Date(edit!.form.endsAt) };
    if (await run(() => (edit!.id ? api(`/admin/promotions/${edit!.id}`, body, 'PUT') : api('/admin/promotions', body)))) setEdit(null);
  };
  const f = edit?.form;
  const set = (patch: Partial<Form>) => setEdit((e) => e && { ...e, form: { ...e.form, ...patch } });

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Акции</h1>
        </div>
        <Button onClick={() => setEdit({ form: empty() })}>Создать акцию</Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <section className={`${s.panel} ${s.scroll}`} style={{ marginBottom: 16 }}>
        <h2>Заявки на модерации · {apps.length}</h2>
        {apps.length === 0 ? (
          <p className={s.muted}>Новых заявок нет.</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Акция</th>
                <th>Поставщик</th>
                <th>Товар</th>
                <th>Скидка</th>
                <th>Цена</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>{a.promotion}</td>
                  <td>{a.supplier}</td>
                  <td>{a.product}</td>
                  <td>
                    {a.discountPct}% <span className={s.muted}>(мин. {a.minDiscountPct}%)</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatRub(a.salePrice)} <span className={s.muted}>вместо {formatRub(a.price)}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className={s.actions}>
                      <Button onClick={() => run(() => api(`/admin/promotions/applications/${a.id}/approve`, {}))}>Одобрить</Button>
                      <Button variant="outline" onClick={() => setReject({ id: a.id, reason: '' })}>
                        Отклонить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={`${s.panel} ${s.scroll}`}>
        <h2>Все акции</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Акция</th>
              <th>Статус</th>
              <th>Заявки</th>
              <th>Проведение</th>
              <th>Условия</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list?.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <div className={s.muted}>бейдж «{p.badge}»</div>
                </td>
                <td>{PHASE[p.phase]}</td>
                <td>
                  {p.applications}
                  {p.pending > 0 && <span className={s.muted}> · ждут {p.pending}</span>}
                </td>
                <td className={s.muted} style={{ whiteSpace: 'nowrap' }}>
                  заявки {day(p.applyFrom)}–{day(p.applyTo)}
                  <br />
                  акция {day(p.startsAt)}–{day(p.endsAt)}
                </td>
                <td className={s.muted}>
                  от {p.minDiscountPct}% · комиссия {p.commissionBp / 100}%{p.onHomepage && ' · на главной'}
                  {p.newsletter && ' · рассылка'}
                </td>
                <td>
                  <button
                    className={s.link}
                    style={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit' }}
                    onClick={() =>
                      setEdit({
                        id: p.id,
                        form: {
                          name: p.name, description: p.description, badge: p.badge, minDiscountPct: String(p.minDiscountPct), commissionPct: String(p.commissionBp / 100),
                          requirements: p.requirements, onHomepage: p.onHomepage, newsletter: p.newsletter,
                          applyFrom: local(new Date(p.applyFrom)), applyTo: local(new Date(p.applyTo)), startsAt: local(new Date(p.startsAt)), endsAt: local(new Date(p.endsAt)),
                        },
                      })
                    }
                  >
                    Изменить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list?.length === 0 && <p className={s.muted}>Акций ещё нет.</p>}
      </section>

      {edit && f && (
        <Modal eyebrow="Акция платформы" title={edit.id ? 'Изменить акцию' : 'Новая акция'} onClose={() => setEdit(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Название" value={f.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} placeholder="Неделя хирурга" />
            <Field label="Описание" value={f.description} error={errors.description} onChange={(e) => set({ description: e.target.value })} />
            <Field label="Бейдж на карточке" value={f.badge} error={errors.badge} onChange={(e) => set({ badge: e.target.value })} maxLength={24} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <Field label="Мин. скидка, %" type="number" value={f.minDiscountPct} error={errors.minDiscountPct} onChange={(e) => set({ minDiscountPct: e.target.value })} />
              <Field label="Комиссия в акции, %" type="number" step="0.5" value={f.commissionPct} error={errors.commissionPct} onChange={(e) => set({ commissionPct: e.target.value })} />
              <Field label="Приём заявок с" type="datetime-local" value={f.applyFrom} error={errors.applyFrom} onChange={(e) => set({ applyFrom: e.target.value })} />
              <Field label="Приём заявок до" type="datetime-local" value={f.applyTo} error={errors.applyTo} onChange={(e) => set({ applyTo: e.target.value })} />
              <Field label="Акция с" type="datetime-local" value={f.startsAt} error={errors.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
              <Field label="Акция до" type="datetime-local" value={f.endsAt} error={errors.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
            </div>
            <Field label="Требования к товарам" value={f.requirements} onChange={(e) => set({ requirements: e.target.value })} placeholder="Только хирургические костюмы, остаток от 5 шт." />
            <label style={{ display: 'flex', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={f.onHomepage} onChange={(e) => set({ onHomepage: e.target.checked })} /> Раздел на главной
            </label>
            <label style={{ display: 'flex', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={f.newsletter} onChange={(e) => set({ newsletter: e.target.checked })} /> Рассылка покупателям (отметка для маркетинга)
            </label>
            <Button onClick={save}>{edit.id ? 'Сохранить' : 'Создать и оповестить поставщиков'}</Button>
          </div>
        </Modal>
      )}

      {reject && (
        <Modal eyebrow="Заявка в акцию" title="Отклонить" onClose={() => setReject(null)}>
          <Field label="Причина" value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })} placeholder="Цена до акции была завышена" />
          <div style={{ marginTop: 12 }}>
            <Button
              disabled={reject.reason.trim().length < 3}
              onClick={async () => {
                if (await run(() => api(`/admin/promotions/applications/${reject.id}/reject`, { reason: reject.reason }))) setReject(null);
              }}
            >
              Отклонить
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
