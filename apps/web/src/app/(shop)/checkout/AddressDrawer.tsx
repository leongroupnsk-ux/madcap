'use client';

import { addressSchema, type AddressInput } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Drawer, Field } from '@/components/ui';
import { api } from '@/lib/api';
import o from '@/components/shop/order.module.css';

export type SavedAddress = AddressInput & { id: string };
type City = { code: number; city: string; region: string };
type Point = { code: string; name: string; address: string; workTime: string };

export function addressText(a: AddressInput) {
  return a.type === 'pvz' ? `${a.city}, ${a.pvzAddress ?? a.pvzCode}` : [a.city, a.street, a.flat && `кв./офис ${a.flat}`].filter(Boolean).join(', ');
}

const clean = (a: SavedAddress): AddressInput => {
  const { id: _id, ...rest } = a;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== '')) as AddressInput;
};

/** Подсказки города из СДЭК: код города нужен для тарифа и ПВЗ. */
function CitySearch({ value, onPick }: { value: City | null; onPick: (c: City) => void }) {
  const [q, setQ] = useState(value?.city ?? '');
  const [list, setList] = useState<City[]>([]);
  useEffect(() => {
    if (q.trim().length < 2 || q === value?.city) return setList([]);
    const t = setTimeout(() => api<City[]>(`/delivery/cities?q=${encodeURIComponent(q.trim())}`).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q, value?.city]);
  return (
    <div>
      <Field label="Город *" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Начните вводить: Казань" autoComplete="address-level2" />
      {list.length > 0 && (
        <div className={o.suggest} role="listbox">
          {list.map((c) => (
            <button
              key={c.code}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onPick(c);
                setQ(c.city);
                setList([]);
              }}
            >
              <b>{c.city}</b> <span className={o.muted}>{c.region}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Боковая панель «Адрес доставки» (ТЗ §6.2): сохранённые адреса и ПВЗ, новый адрес, выбор ПВЗ. */
export function AddressDrawer({
  initialType,
  saved,
  onClose,
  onPick,
  onDelete,
}: {
  initialType: 'pvz' | 'courier';
  saved: SavedAddress[];
  onClose: () => void;
  onPick: (a: AddressInput) => void;
  onDelete: (id: string) => void;
}) {
  const [type, setType] = useState(initialType);
  const mine = saved.filter((a) => a.type === type);
  const [adding, setAdding] = useState(mine.length === 0);
  const [chosen, setChosen] = useState<string | null>(mine[0]?.id ?? null);
  const [city, setCity] = useState<City | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [pq, setPq] = useState('');
  const [pvz, setPvz] = useState<Point | null>(null);
  const [form, setForm] = useState({ street: '', flat: '', intercom: '', entrance: '', floor: '', comment: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setAdding(saved.filter((a) => a.type === type).length === 0);
    setChosen(saved.find((a) => a.type === type)?.id ?? null);
    setErrors({});
  }, [type, saved]);

  useEffect(() => {
    if (!city || type !== 'pvz') return;
    setPoints(null);
    setPvz(null);
    api<Point[]>(`/delivery/points?cityCode=${city.code}`).then(setPoints).catch(() => setPoints([]));
  }, [city, type]);

  const submit = () => {
    if (!adding) {
      const a = saved.find((x) => x.id === chosen);
      if (a) onPick(clean(a));
      return;
    }
    const draft = {
      type,
      cityCode: city?.code ?? 0,
      city: city?.city ?? '',
      ...(type === 'pvz' ? { pvzCode: pvz?.code, pvzAddress: pvz?.address } : Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))),
    };
    const r = addressSchema.safeParse(draft);
    if (!city) return setErrors({ city: 'Выберите город из подсказок' });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    onPick(r.data);
  };

  const shown = (points ?? []).filter((p) => !pq.trim() || `${p.name} ${p.address}`.toLowerCase().includes(pq.trim().toLowerCase())).slice(0, 60);

  return (
    <Drawer eyebrow="Доставка СДЭК" title="Адрес доставки" onClose={onClose}>
      <div className={o.tabs} role="tablist">
        <Chip active={type === 'courier'} onClick={() => setType('courier')} role="tab">
          Курьер
        </Chip>
        <Chip active={type === 'pvz'} onClick={() => setType('pvz')} role="tab">
          Самовывоз
        </Chip>
      </div>

      {mine.length > 0 && (
        <div className={o.saved}>
          {mine.map((a) => (
            <label key={a.id} className={o.savedItem}>
              <input
                type="radio"
                name="saved"
                checked={!adding && chosen === a.id}
                onChange={() => {
                  setAdding(false);
                  setChosen(a.id);
                }}
              />
              <span>{addressText(a)}</span>
              <button type="button" className={o.link} onClick={() => onDelete(a.id)} aria-label="Удалить адрес">
                Удалить
              </button>
            </label>
          ))}
          {!adding && (
            <button type="button" className={o.link} onClick={() => setAdding(true)}>
              + Добавить {type === 'pvz' ? 'пункт выдачи' : 'новый адрес'}
            </button>
          )}
        </div>
      )}

      {adding && (
        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ fontSize: 20 }}>{type === 'pvz' ? 'Выберите пункт выдачи' : 'Укажите адрес доставки'}</h3>
          <CitySearch value={city} onPick={setCity} />
          {errors.city && <span className={o.warn}>{errors.city}</span>}
          {type === 'pvz' && city && (
            <div>
              <Field label="Поиск пункта" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Улица или метро" />
              {points === null ? (
                <p className={o.muted}>Загружаем пункты выдачи…</p>
              ) : points.length === 0 ? (
                <p className={o.muted}>В этом городе нет пунктов выдачи СДЭК — выберите курьера.</p>
              ) : (
                <div className={o.points} role="listbox" aria-label="Пункты выдачи">
                  {shown.map((p) => (
                    <button key={p.code} type="button" role="option" aria-selected={pvz?.code === p.code} className={pvz?.code === p.code ? o.pointOn : o.point} onClick={() => setPvz(p)}>
                      <b>{p.address}</b>
                      <div className={o.muted}>
                        {p.code} · {p.workTime}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {errors.pvzCode && <span className={o.warn}>{errors.pvzCode}</span>}
            </div>
          )}
          {type === 'courier' && (
            <>
              <Field label="Улица и дом *" value={form.street} error={errors.street} onChange={(e) => setForm({ ...form, street: e.target.value })} autoComplete="street-address" />
              <div className={o.grid2}>
                <Field label="Кв./офис" value={form.flat} onChange={(e) => setForm({ ...form, flat: e.target.value })} />
                <Field label="Домофон" value={form.intercom} onChange={(e) => setForm({ ...form, intercom: e.target.value })} />
                <Field label="Подъезд" value={form.entrance} onChange={(e) => setForm({ ...form, entrance: e.target.value })} />
                <Field label="Этаж" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
              </div>
              <Field label="Комментарий курьеру" value={form.comment} error={errors.comment} maxLength={500} onChange={(e) => setForm({ ...form, comment: e.target.value })} hint="До 500 символов" />
            </>
          )}
        </div>
      )}

      {Object.keys(errors).length > 0 && !errors.city && !errors.street && !errors.pvzCode && <Alert tone="error">{Object.values(errors)[0]}</Alert>}
      <div style={{ marginTop: 20 }}>
        <Button block onClick={submit} disabled={!adding && !chosen}>
          Привезти сюда
        </Button>
      </div>
    </Drawer>
  );
}
