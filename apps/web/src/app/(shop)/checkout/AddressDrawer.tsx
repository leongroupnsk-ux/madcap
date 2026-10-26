'use client';

import { addressSchema, formatRub, type AddressInput } from '@aesculap/shared';
import { useEffect, useMemo, useState } from 'react';
import { useEscape } from '@/components/ui';
import { api } from '@/lib/api';
import c from '@/components/shop/checkout.module.css';
import { PvzMap } from './PvzMap';

export type SavedAddress = AddressInput & { id: string };
export type Quote = { type: 'pvz' | 'courier'; tariffCode: number; price: number; periodMin: number; periodMax: number };
type City = { code: number; city: string; region?: string };
type Point = { code: string; name: string; address: string; workTime: string; lat: number; lon: number };
/** Что включено ключами в API: карта ПВЗ (ключ Яндекс Карт) и подсказки адреса курьера (DaData) */
export type DeliveryFeatures = { mapKey: string | null; addressSuggest: boolean };
type AddressSuggestion = { value: string; street: string; city: string; cityCode: number | null; postalCode: string | null };

const MOSCOW: City = { code: 44, city: 'Москва' };

export function addressText(a: AddressInput) {
  return a.type === 'pvz' ? `${a.city}, ${a.pvzAddress ?? a.pvzCode}` : [a.city, a.street, a.flat && `кв./офис ${a.flat}`].filter(Boolean).join(', ');
}

/** «12 сентября» или «10–12 сентября» — ориентировочная дата по сроку тарифа. */
export function deliveryDates(q: Pick<Quote, 'periodMin' | 'periodMax'>) {
  const at = (d: number) => new Date(Date.now() + d * 86400000);
  const max = at(q.periodMax);
  const full = max.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (q.periodMin === q.periodMax) return full;
  const min = at(q.periodMin);
  return min.getMonth() === max.getMonth() ? `${min.getDate()}–${full}` : `${min.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} – ${full}`;
}

const clean = (a: SavedAddress): AddressInput => {
  const { id: _id, ...rest } = a;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== '')) as AddressInput;
};

/** Поле «Город» с подсказками СДЭК: код города нужен для тарифа и ПВЗ. */
function CityInput({ value, onPick, autoFocus }: { value: City | null; onPick: (c: City) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState(value?.city ?? '');
  const [list, setList] = useState<City[]>([]);
  useEffect(() => {
    if (q.trim().length < 2 || q === value?.city) return setList([]);
    const t = setTimeout(() => api<City[]>(`/delivery/cities?q=${encodeURIComponent(q.trim())}`).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q, value?.city]);
  return (
    <>
      <input className={c.formInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Начните вводить: Казань" autoComplete="address-level2" autoFocus={autoFocus} />
      {list.length > 0 && (
        <div className={c.suggest} role="listbox">
          {list.map((x) => (
            <button
              key={x.code}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onPick(x);
                setQ(x.city);
                setList([]);
              }}
            >
              {x.city}
              {x.region && x.region !== x.city && <small>{x.region}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Поле «Улица и дом» с подсказками DaData (E4-10) в стиле подсказок города. Без ключа в API (enabled = false) —
 * обычное поле, запросов нет. Выбор подсказки подставляет улицу с домом и, если адрес в другом городе, — город СДЭК.
 */
function StreetInput({
  value,
  city,
  enabled,
  onChange,
  onPick,
}: {
  value: string;
  city: City | null;
  enabled: boolean;
  onChange: (v: string) => void;
  onPick: (s: AddressSuggestion) => void;
}) {
  const [list, setList] = useState<AddressSuggestion[]>([]);
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (!enabled || !typed || value.trim().length < 3) return setList([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ q: value.trim(), ...(city ? { city: city.city } : {}) });
      fetch(`/api/delivery/address-suggest?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<AddressSuggestion[]>) : []))
        .then(setList)
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [enabled, typed, value, city]);
  return (
    <>
      <input
        className={c.formInput}
        value={value}
        onChange={(e) => {
          setTyped(true);
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setList([]), 150)}
        autoComplete="street-address"
        maxLength={200}
      />
      {list.length > 0 && (
        <div className={c.suggest} role="listbox" aria-label="Подсказки адреса">
          {list.map((x) => (
            <button
              key={x.value}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(x);
                setTyped(false);
                setList([]);
              }}
            >
              {x.street}
              <small>{[x.city !== city?.city && x.city, x.postalCode].filter(Boolean).join(', ')}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

type Form = { street: string; flat: string; intercom: string; entrance: string; floor: string; comment: string };
const EMPTY_FORM: Form = { street: '', flat: '', intercom: '', entrance: '', floor: '', comment: '' };

/**
 * Окно «Адрес доставки» для одного отправления (ТЗ §6.2) — кадры cdek-courier-1/2, cdek-shop-1/2, cdek-shops.
 * Сохранённые адреса и ПВЗ, новый адрес курьеру (с подсказками DaData, если есть ключ), выбор ПВЗ списком и на карте (без ключа карт — заглушка).
 */
export function AddressDrawer({
  initialType,
  features,
  saved,
  current,
  quoteFor,
  onClose,
  onPick,
  onDelete,
  onSaved,
}: {
  initialType: 'pvz' | 'courier';
  features: DeliveryFeatures;
  saved: SavedAddress[];
  current?: AddressInput;
  /** Тарифы этого отправления до города (из общего кэша оформления) */
  quoteFor: (cityCode: number) => Promise<Quote[] | undefined>;
  onClose: () => void;
  onPick: (a: AddressInput) => void;
  onDelete: (id: string) => void;
  onSaved: (a: SavedAddress) => void;
}) {
  const [type, setType] = useState(initialType);
  const mine = saved.filter((a) => a.type === type);
  const matchCurrent = (a: SavedAddress) =>
    current && a.type === current.type && a.cityCode === current.cityCode && (a.type === 'pvz' ? a.pvzCode === current.pvzCode : a.street === current.street && (a.flat ?? '') === (current.flat ?? ''));
  const [chosen, setChosen] = useState<string | null>((saved.find((a) => a.type === initialType && matchCurrent(a)) ?? saved.find((a) => a.type === initialType))?.id ?? null);
  // list — сохранённые; form — новый адрес курьеру; shops — выбор ПВЗ на весь экран
  const [view, setView] = useState<'list' | 'form' | 'shops'>(() => (saved.some((a) => a.type === initialType) ? 'list' : initialType === 'pvz' ? 'shops' : 'form'));
  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [shopsStart, setShopsStart] = useState<{ city: City; point?: string } | null>(null);

  useEscape(onClose);

  const switchType = (t: 'pvz' | 'courier') => {
    setType(t);
    setChosen(saved.find((a) => a.type === t)?.id ?? null);
  };

  const remove = (id: string) => {
    onDelete(id);
    if (chosen === id) setChosen(mine.find((a) => a.id !== id)?.id ?? null);
  };

  const saveAndUse = async (a: AddressInput, replace?: SavedAddress | null) => {
    try {
      const created = await api<SavedAddress>('/me/addresses', a);
      onSaved(created);
      if (replace) onDelete(replace.id);
      return created;
    } catch {
      // Не сохранилось (лимит адресов, нет связи) — адрес всё равно уйдёт в заказ
      return null;
    }
  };

  const defaultCity = (): City => {
    const from = current?.type === type ? current : saved.find((a) => a.type === type) ?? saved[0];
    return from ? { code: from.cityCode, city: from.city } : MOSCOW;
  };

  if (view === 'shops') {
    return (
      <PointPicker
        start={shopsStart ?? { city: defaultCity(), point: current?.type === 'pvz' ? current.pvzCode : undefined }}
        mapKey={features.mapKey}
        quoteFor={quoteFor}
        onBack={() => (saved.some((a) => a.type === 'pvz') ? setView('list') : onClose())}
        onPick={async (a) => {
          await saveAndUse(a);
          onPick(a);
        }}
      />
    );
  }

  return (
    <div className={c.overlay} onClick={onClose}>
      <aside className={c.drawer} role="dialog" aria-modal="true" aria-label="Адрес доставки" onClick={(e) => e.stopPropagation()}>
        <div className={c.drawerHead}>
          <div>
            <div className={c.eyebrow}>Доставка</div>
            <h2>{view === 'form' ? 'Укажите адрес доставки' : 'Адрес доставки'}</h2>
          </div>
          <button type="button" className={c.close} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        {view === 'list' && (
          <>
            <div className={c.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={type === 'courier'} className={type === 'courier' ? c.tabOn : c.tab} onClick={() => switchType('courier')}>
                Курьер
              </button>
              <button type="button" role="tab" aria-selected={type === 'pvz'} className={type === 'pvz' ? c.tabOn : c.tab} onClick={() => switchType('pvz')}>
                Самовывоз
              </button>
            </div>
            <div className={c.panel}>
              {mine.length === 0 ? (
                <p className={c.panelEmpty}>{type === 'pvz' ? 'Сохранённых пунктов выдачи пока нет.' : 'Сохранённых адресов пока нет.'}</p>
              ) : (
                <div className={c.saved} role="radiogroup" aria-label={type === 'pvz' ? 'Пункты выдачи' : 'Адреса'}>
                  {mine.map((a) => {
                    const on = chosen === a.id;
                    return (
                      <div key={a.id} className={on ? c.savedItemOn : c.savedItem} role="radio" aria-checked={on} tabIndex={0} onClick={() => setChosen(a.id)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setChosen(a.id)}>
                        {on ? <img src="/design/checkout/radio-on.svg" alt="" width={20} height={20} /> : <span className={c.radio} />}
                        <span className={c.savedText}>
                          <b>{a.type === 'pvz' ? `СДЭК, ${a.pvzAddress ?? a.pvzCode}` : [a.street, a.flat && `кв. ${a.flat}`].filter(Boolean).join(', ')}</b>
                          <span>{a.city}</span>
                        </span>
                        <span className={c.iconBtns}>
                          {a.type === 'pvz' ? (
                            <button
                              type="button"
                              className={c.iconBtn}
                              aria-label="Показать пункт выдачи"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShopsStart({ city: { code: a.cityCode, city: a.city }, point: a.pvzCode });
                                setView('shops');
                              }}
                            >
                              <img src="/design/checkout/arrow-up-right.svg" alt="" width={8.67} height={8.67} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={c.iconBtn}
                              aria-label="Изменить адрес"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditing(a);
                                setView('form');
                              }}
                            >
                              <img src="/design/checkout/pencil.svg" alt="" width={14} height={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className={c.iconBtn}
                            aria-label="Удалить"
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(a.id);
                            }}
                          >
                            <img src={on ? '/design/checkout/x-muted.svg' : '/design/checkout/x.svg'} alt="" width={14} height={14} />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className={c.panelFoot}>
                <button
                  type="button"
                  className={c.outlineCaps}
                  onClick={() => {
                    setEditing(null);
                    setShopsStart(null);
                    setView(type === 'pvz' ? 'shops' : 'form');
                  }}
                >
                  {type === 'pvz' ? '+ Добавить новый пункт выдачи' : '+ Добавить новый адрес'}
                </button>
                <button
                  type="button"
                  className={c.darkCaps}
                  disabled={!mine.some((a) => a.id === chosen)}
                  onClick={() => {
                    const a = mine.find((x) => x.id === chosen);
                    if (a) onPick(clean(a));
                  }}
                >
                  Привезти сюда
                </button>
              </div>
            </div>
          </>
        )}

        {view === 'form' && (
          <CourierForm
            initial={editing}
            fallbackCity={defaultCity()}
            addressSuggest={features.addressSuggest}
            canGoBack={saved.some((a) => a.type === 'courier')}
            onBack={() => setView('list')}
            onSave={async (a) => {
              const created = await saveAndUse(a, editing);
              if (created) {
                setType('courier');
                setChosen(created.id);
                setEditing(null);
                setView('list');
              } else onPick(a);
            }}
          />
        )}
      </aside>
    </div>
  );
}

/** Форма адреса курьеру (cdek-courier-2). */
function CourierForm({
  initial,
  fallbackCity,
  addressSuggest,
  canGoBack,
  onBack,
  onSave,
}: {
  initial: SavedAddress | null;
  fallbackCity: City;
  addressSuggest: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onSave: (a: AddressInput) => Promise<void>;
}) {
  const [city, setCity] = useState<City | null>(initial ? { code: initial.cityCode, city: initial.city } : fallbackCity);
  const [form, setForm] = useState<Form>(
    initial
      ? { street: initial.street ?? '', flat: initial.flat ?? '', intercom: initial.intercom ?? '', entrance: initial.entrance ?? '', floor: initial.floor ?? '', comment: initial.comment ?? '' }
      : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    if (!city) return setErrors({ city: 'Выберите город из подсказок' });
    const r = addressSchema.safeParse({ type: 'courier', cityCode: city.code, city: city.city, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())) });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    setBusy(true);
    await onSave(r.data);
    setBusy(false);
  };

  const field = (k: keyof Form, label: string, autoComplete?: string) => (
    <label className={c.formField}>
      <span>{label}</span>
      <input className={c.formInput} value={form[k]} onChange={set(k)} autoComplete={autoComplete} maxLength={k === 'street' ? 200 : 20} />
      {errors[k] && <span className={c.fieldError}>{errors[k]}</span>}
    </label>
  );

  return (
    <div className={c.panel}>
      <div className={c.form}>
        <div className={c.formField}>
          <span>Город *</span>
          <CityInput value={city} onPick={setCity} />
          {errors.city && <span className={c.fieldError}>{errors.city}</span>}
        </div>
        <div className={c.formField}>
          <span>Улица и дом *</span>
          <StreetInput
            value={form.street}
            city={city}
            enabled={addressSuggest}
            onChange={(street) => setForm((f) => ({ ...f, street }))}
            onPick={(x) => {
              setForm((f) => ({ ...f, street: x.street }));
              // Адрес в другом городе — переключаем город, если удалось сопоставить код СДЭК
              if (x.cityCode && x.cityCode !== city?.code) setCity({ code: x.cityCode, city: x.city });
            }}
          />
          {errors.street && <span className={c.fieldError}>{errors.street}</span>}
        </div>
        <div className={c.formRow}>
          {field('flat', 'Кв./офис')}
          {field('intercom', 'Домофон')}
        </div>
        <div className={c.formRow}>
          {field('entrance', 'Подъезд')}
          {field('floor', 'Этаж')}
        </div>
        <label className={`${c.formField} ${c.formGrow}`}>
          <span>Комментарий курьеру</span>
          <textarea className={c.formArea} value={form.comment} onChange={set('comment')} maxLength={500} />
          {errors.comment && <span className={c.fieldError}>{errors.comment}</span>}
        </label>
      </div>
      <div className={c.panelFoot}>
        {canGoBack && (
          <button type="button" className={c.outlineCaps} onClick={onBack}>
            ← К сохранённым адресам
          </button>
        )}
        <button type="button" className={c.darkCaps} onClick={submit} disabled={busy}>
          Сохранить
        </button>
      </div>
    </div>
  );
}

/**
 * Выбор ПВЗ (cdek-shops + cdek-shop-2): пункты списком с поиском и на карте Яндекса (если задан ключ),
 * без ключа — заглушка в стиле макета с пронумерованными метками.
 */
function PointPicker({
  start,
  mapKey,
  quoteFor,
  onBack,
  onPick,
}: {
  start: { city: City; point?: string };
  mapKey: string | null;
  quoteFor: (cityCode: number) => Promise<Quote[] | undefined>;
  onBack: () => void;
  onPick: (a: AddressInput) => Promise<void>;
}) {
  // Карта — только с ключом; если не загрузилась, остаётся заглушка со списком
  const [mapFailed, setMapFailed] = useState(false);
  const withMap = Boolean(mapKey) && !mapFailed;
  const [city, setCity] = useState<City>(start.city);
  const [cityOpen, setCityOpen] = useState(false);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(start.point ?? null);
  const [busy, setBusy] = useState(false);

  useEscape(onBack);

  useEffect(() => {
    let stop = false;
    setPoints(null);
    setQuote(undefined);
    api<Point[]>(`/delivery/points?cityCode=${city.code}`)
      .then((p) => !stop && setPoints(p))
      .catch(() => !stop && setPoints([]));
    quoteFor(city.code)
      .then((list) => !stop && setQuote(list?.find((x) => x.type === 'pvz') ?? null))
      .catch(() => !stop && setQuote(null));
    return () => {
      stop = true;
    };
  }, [city, quoteFor]);

  const shown = useMemo(() => (points ?? []).filter((p) => !q.trim() || `${p.name} ${p.address}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 100), [points, q]);
  const point = points?.find((p) => p.code === open) ?? null;

  const choose = async (p: Point) => {
    setBusy(true);
    await onPick({ type: 'pvz', cityCode: city.code, city: city.city, pvzCode: p.code, pvzAddress: p.address });
    setBusy(false);
  };

  // «Пн-Пт 09:00-21:00, Сб-Вс 10:00-18:00» → по строке на интервал
  const hours = (w: string) => w.split(/[,;]\s*/).filter(Boolean);

  return (
    <div className={c.shops} role="dialog" aria-modal="true" aria-label="Пункты выдачи">
      <div className={c.map}>
        {withMap && mapKey ? (
          <PvzMap apiKey={mapKey} points={shown} selected={open} onSelect={setOpen} onFail={() => setMapFailed(true)} />
        ) : (
          <div className={c.markers} aria-hidden={!points?.length}>
            {shown.slice(0, 40).map((p, i) => (
              <button key={p.code} type="button" className={p.code === open ? c.markerOn : c.marker} onClick={() => setOpen(p.code)} aria-label={p.address}>
                {i + 1}
              </button>
            ))}
          </div>
        )}
        <div className={c.mapTop}>
          <div className={c.cityBox}>
            {cityOpen ? (
              <div className={c.formField}>
                <CityInput
                  value={null}
                  autoFocus
                  onPick={(x) => {
                    setCity(x);
                    setOpen(null);
                    setCityOpen(false);
                  }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex' }}>
                <button type="button" className={c.cityBtn} onClick={() => setCityOpen(true)} aria-label={`Город: ${city.city}. Изменить`}>
                  {city.city} ▼
                </button>
              </div>
            )}
          </div>
        </div>
        {!withMap && <div className={c.mapNote}>Карта появится позже — выберите пункт в списке</div>}
      </div>

      <aside className={c.shopsSide}>
        {point ? (
          <>
            <div className={c.shopsHead}>
              <h2>СДЭК</h2>
              <button type="button" className={c.close} onClick={() => setOpen(null)} aria-label="Назад к списку">
                ×
              </button>
            </div>
            <div className={c.shopList} style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column' }}>
              <div className={c.pointCard} style={{ marginTop: 0, padding: 0 }}>
                <h3>{point.address}</h3>
                <dl>
                  <dd>
                    Стоимость — <b>{quote ? formatRub(quote.price) : quote === null ? 'недоступно' : '…'}</b>
                  </dd>
                  {quote && (
                    <dd>
                      Дата доставки — <b>{deliveryDates(quote)}</b>
                    </dd>
                  )}
                </dl>
                {point.workTime && (
                  <dl>
                    <dt>Режим работы</dt>
                    {hours(point.workTime).map((h) => (
                      <dd key={h}>{h}</dd>
                    ))}
                  </dl>
                )}
                <dl>
                  <dt>Срок хранения</dt>
                  <dd>7 рабочих дней</dd>
                </dl>
                <button type="button" className={c.darkCaps} disabled={busy || quote === null} onClick={() => choose(point)}>
                  Привезти сюда
                </button>
                {quote === null && <p className={c.fieldError}>СДЭК не доставляет это отправление в пункты выдачи {city.city}.</p>}
              </div>
              <div className={c.pointMap}>
                <span className={c.pin}>
                  <img src="/design/checkout/map-pin.svg" alt="" width={14} height={14} />
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={c.shopsHead}>
              <div>
                <div className={c.eyebrow}>Доставка</div>
                <h2>Пункты выдачи</h2>
              </div>
              <button type="button" className={c.close} onClick={onBack} aria-label="Закрыть">
                ×
              </button>
            </div>
            <label className={c.search}>
              <span className={c.srOnly}>Поиск пункта выдачи</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="найти адрес" />
              <img src="/design/icons/search.svg" alt="" width={16} height={16} />
            </label>
            <div className={c.shopList} role="listbox" aria-label="Пункты выдачи">
              {points === null ? (
                <p className={c.shopsMsg}>Загружаем пункты выдачи…</p>
              ) : points.length === 0 ? (
                <p className={c.shopsMsg}>В городе {city.city} нет пунктов выдачи СДЭК — выберите другой город или курьера.</p>
              ) : shown.length === 0 ? (
                <p className={c.shopsMsg}>Ничего не нашли по запросу «{q}».</p>
              ) : (
                shown.map((p) => (
                  <button key={p.code} type="button" role="option" aria-selected={p.code === open} className={p.code === start.point ? c.shopItemOn : c.shopItem} onClick={() => setOpen(p.code)}>
                    <span className={c.shopBrand}>СДЭК</span>
                    <span className={c.shopAddr}>{p.address}</span>
                    <span className={c.shopInfo}>стоимость - {quote ? formatRub(quote.price) : quote === null ? 'недоступно' : '…'}</span>
                    {quote && <span className={c.shopInfo}>дата доставки - {deliveryDates(quote)}</span>}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
