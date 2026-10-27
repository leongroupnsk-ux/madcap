'use client';

import { formatRub, plural } from '@aesculap/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import p from './product.module.css';

type City = { code: number; city: string; region?: string };
type Option = { price: number; periodMin: number; periodMax: number } | null;
type Estimate = {
  city: { code: number; name: string; source: 'picked' | 'address' | 'stored' | 'default' };
  from: string | null;
  pvz: Option;
  courier: Option;
  periodMin: number | null;
  periodMax: number | null;
};

/** Город, выбранный в карточке товара, — в браузере (у гостя и у вошедшего без сохранённых адресов) */
const KEY = 'delivery-city';

function readCity(): City | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.code === 'number' && typeof v.city === 'string' ? { code: v.code, city: v.city } : null;
  } catch {
    return null;
  }
}

function saveCity(c: City) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: c.code, city: c.city }));
  } catch {
    /* приватный режим — город будет до перезагрузки */
  }
}

const inCity = (city: string) => (city === 'Москва' ? 'Москве' : city === 'Санкт-Петербург' ? 'Санкт-Петербурге' : city);

/**
 * Доставка на странице товара: «ПВЗ от N ₽, курьер от M ₽, N–M дней» по тарифам СДЭК от склада поставщика.
 * Считается в браузере после отрисовки (не мешает LCP). Город: вошедший — из первого сохранённого адреса,
 * гость — выбранный здесь (через подсказки городов СДЭК, запоминается в браузере) или Москва.
 */
export function DeliveryEstimate({ slug, variantId, sellerCity }: { slug: string; variantId: string | null; sellerCity: string | null }) {
  const [est, setEst] = useState<Estimate | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<City | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const ctrl = { cancelled: false };
    const city = picked ?? readCity();
    const qs = new URLSearchParams();
    if (variantId) qs.set('variantId', variantId);
    if (city) {
      qs.set('cityCode', String(city.code));
      qs.set('city', city.city);
    }
    if (picked) qs.set('picked', '1');
    api<Estimate>(`/catalog/products/${encodeURIComponent(slug)}/delivery?${qs}`)
      .then((r) => {
        if (ctrl.cancelled) return;
        setEst(r);
        setFailed(false);
      })
      .catch(() => !ctrl.cancelled && setFailed(true));
    return () => {
      ctrl.cancelled = true;
    };
  }, [slug, variantId, picked]);

  const from = est?.from ?? sellerCity;
  const fromText = `со склада поставщика${from ? ` в ${inCity(from)}` : ''}`;
  const cityName = picked?.city ?? est?.city.name ?? 'Москва';
  let line: string;
  if (failed) line = 'Срок и цена — при оформлении';
  else if (!est) line = 'Считаем стоимость и срок…';
  else if (!est.pvz && !est.courier) line = 'Срок и цена — при оформлении';
  else {
    const parts = [est.pvz && `ПВЗ от ${formatRub(est.pvz.price)}`, est.courier && `курьер от ${formatRub(est.courier.price)}`].filter(Boolean) as string[];
    const days = est.periodMin === est.periodMax ? `${est.periodMax}` : `${est.periodMin}–${est.periodMax}`;
    parts.push(`${days} ${plural(est.periodMax ?? 0, 'день', 'дня', 'дней')}`);
    line = parts.join(', ');
    line = line[0].toUpperCase() + line.slice(1);
  }

  return (
    <div className={p.delivery}>
      <img src="/design/icons/delivery.svg" alt="" width={20} height={20} />
      <span className={p.deliveryBody}>
        <b>СДЭК: пункт выдачи или курьер</b>
        <small className={p.deliveryQuote} aria-live="polite">
          {line}
        </small>
        <small className={p.deliveryCity}>
          {editing ? (
            <CityPicker
              onPick={(c) => {
                saveCity(c);
                setPicked(c);
                setEditing(false);
              }}
              onClose={() => setEditing(false)}
            />
          ) : (
            <>
              Куда:{' '}
              <button type="button" className={p.cityBtn} onClick={() => setEditing(true)} aria-label={`Город доставки: ${cityName}. Изменить`}>
                {cityName}
              </button>
              {' · '}
              {fromText}
            </>
          )}
        </small>
      </span>
    </div>
  );
}

/** Выбор города по подсказкам СДЭК (как поле «Город» при оформлении) */
function CityPicker({ onPick, onClose }: { onPick: (c: City) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<City[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setList([]);
    const t = setTimeout(() => api<City[]>(`/delivery/cities?q=${encodeURIComponent(q.trim())}`).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <span className={p.cityPicker}>
      <input
        ref={ref}
        className={p.cityInput}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && list[0]) onPick(list[0]);
        }}
        onBlur={(e) => {
          // Клик по подсказке не должен закрывать список раньше выбора
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) onClose();
        }}
        placeholder="Город доставки: начните вводить"
        aria-label="Город доставки"
        autoComplete="address-level2"
      />
      {list.length > 0 && (
        <span className={p.citySuggest} role="listbox" aria-label="Города">
          {list.map((x) => (
            <button key={x.code} type="button" role="option" aria-selected={false} onClick={() => onPick(x)}>
              {x.city}
              {x.region && x.region !== x.city && <small>{x.region}</small>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
