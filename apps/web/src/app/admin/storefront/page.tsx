'use client';

import { DEFAULT_STOREFRONT, storefrontSchema, type MenuItem, type StorefrontSettings } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type P = { id: string; title: string; brand: string; image: string | null; visible: boolean };
type Data = { settings: StorefrontSettings; hits: P[]; capsule: P[] };

/** Список товаров с поиском, порядком и удалением — для хитов и «Капсулы недели» */
function Picker({ items, max, onChange }: { items: P[]; max: number; onChange: (items: P[]) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<P[]>([]);
  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const t = setTimeout(() => api<P[]>(`/admin/storefront/products?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {p.image ? <img src={p.image} alt="" className={s.thumb} /> : <span className={s.thumb} />}
          <span style={{ flex: 1, minWidth: 0 }}>
            {p.title}
            <div className={s.muted}>
              {p.brand}
              {!p.visible && ' · снят с витрины — не показывается'}
            </div>
          </span>
          <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">
            ↑
          </button>
          <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">
            ↓
          </button>
          <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => onChange(items.filter((x) => x.id !== p.id))}>
            Убрать
          </button>
        </div>
      ))}
      {items.length < max && (
        <div>
          <input className={s.input} style={{ width: '100%' }} placeholder="Найти товар по названию или бренду" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск товара" />
          {found
            .filter((f) => !items.some((x) => x.id === f.id))
            .slice(0, 8)
            .map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onChange([...items, f]);
                  setQ('');
                }}
                style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', border: 0, background: 'none', padding: '6px 0', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
              >
                {f.image ? <img src={f.image} alt="" className={s.thumb} /> : <span className={s.thumb} />}
                {f.title} <span className={s.muted}>· {f.brand}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

const ERR = { color: 'var(--c-error)', fontSize: 13, marginTop: 4 } as const;
const TONES = { '': 'Обычный', sale: 'Распродажа (терракотовый)', strong: 'Выделенный' } as const;

/** Меню категорий в шапке: порядок, название, ссылка, цвет */
function MenuEditor({ items, errors, onChange }: { items: MenuItem[]; errors: Record<string, string>; onChange: (items: MenuItem[]) => void }) {
  const set = (i: number, patch: Partial<MenuItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const btn = { border: 0, background: 'none', cursor: 'pointer' } as const;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <input className={s.input} style={{ width: '100%' }} value={m.label} onChange={(e) => set(i, { label: e.target.value })} aria-label={`Название пункта ${i + 1}`} />
            {errors[`menu.${i}.label`] && <div style={ERR}>{errors[`menu.${i}.label`]}</div>}
          </div>
          <div style={{ flex: '2 1 200px' }}>
            <input className={s.input} style={{ width: '100%' }} value={m.href} onChange={(e) => set(i, { href: e.target.value })} aria-label={`Ссылка пункта ${i + 1}`} placeholder="/catalog/halaty" />
            {errors[`menu.${i}.href`] && <div style={ERR}>{errors[`menu.${i}.href`]}</div>}
          </div>
          <select className={s.input} value={m.tone} onChange={(e) => set(i, { tone: e.target.value as MenuItem['tone'] })} aria-label={`Цвет пункта ${i + 1}`}>
            {Object.entries(TONES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className={s.link} style={btn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">
            ↑
          </button>
          <button className={s.link} style={btn} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">
            ↓
          </button>
          <button className={s.link} style={btn} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Убрать
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 16 }}>
        {items.length < 12 && (
          <button className={s.link} style={btn} onClick={() => onChange([...items, { label: '', href: '/catalog', tone: '' }])}>
            + Добавить пункт
          </button>
        )}
        <button className={s.link} style={btn} onClick={() => onChange(DEFAULT_STOREFRONT.menu)}>
          Вернуть по умолчанию
        </button>
      </div>
      {errors.menu && <div style={ERR}>{errors.menu}</div>}
    </div>
  );
}

/** Витрина (ТЗ §8): главный блок, премиум-баннер, «Хиты недели», «Капсула недели». */
export default function AdminStorefrontPage() {
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    api<Data>('/admin/storefront').then(setD).catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
  }, []);
  if (!d) return msg ? <Alert tone="error">{msg.text}</Alert> : null;
  const st = d.settings;
  const set = (patch: Partial<StorefrontSettings>) => setD({ ...d, settings: { ...st, ...patch } });

  const save = async () => {
    setMsg(null);
    const body = { ...st, hitsProductIds: d.hits.map((p) => p.id), capsuleOfWeek: { ...st.capsuleOfWeek, productIds: d.capsule.map((p) => p.id) } };
    const r = storefrontSchema.safeParse(body);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message])));
      return setMsg({ tone: 'error', text: 'Проверьте поля' });
    }
    try {
      setD(await api<Data>('/admin/storefront', r.data, 'PUT'));
      setErrors({});
      setMsg({ tone: 'success', text: 'Сохранено — главная обновится в течение минуты' });
    } catch (e) {
      setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Нет связи с сервером' });
    }
  };

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Витрина</h1>
        </div>
        <div className={s.actions}>
          <a className={s.link} href="/" target="_blank" rel="noreferrer" style={{ alignSelf: 'center' }}>
            Открыть главную ↗
          </a>
          <Button onClick={save}>Сохранить</Button>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={s.detail} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <section className={s.panel}>
            <h2>Главный блок</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Надзаголовок" value={st.hero.eyebrow} onChange={(e) => set({ hero: { ...st.hero, eyebrow: e.target.value } })} />
              <Field label="Заголовок" value={st.hero.title} error={errors['hero.title']} onChange={(e) => set({ hero: { ...st.hero, title: e.target.value } })} />
              <Field label="Выделить курсивом (слово из заголовка)" value={st.hero.accent} onChange={(e) => set({ hero: { ...st.hero, accent: e.target.value } })} />
              <Field label="Текст" value={st.hero.text} onChange={(e) => set({ hero: { ...st.hero, text: e.target.value } })} />
              <Field label="Кнопка" value={st.hero.cta} error={errors['hero.cta']} onChange={(e) => set({ hero: { ...st.hero, cta: e.target.value } })} />
            </div>
          </section>
          <section className={s.panel}>
            <h2>Меню категорий</h2>
            <p className={s.muted} style={{ marginBottom: 10 }}>
              Строка под поиском в шапке сайта. Только ссылки на страницы сайта.
            </p>
            <MenuEditor items={st.menu} errors={errors} onChange={(menu) => set({ menu })} />
          </section>
          <section className={s.panel}>
            <h2>Хиты недели</h2>
            <p className={s.muted} style={{ marginBottom: 10 }}>
              Пусто — товары с наибольшими продажами за 7 дней, добираются новинками. Добавьте товары, чтобы закрепить свой порядок.
            </p>
            <Picker items={d.hits} max={15} onChange={(hits) => setD({ ...d, hits })} />
          </section>
          <section className={s.panel}>
            <h2>Капсула недели</h2>
            <p className={s.muted} style={{ marginBottom: 10 }}>
              Подборка из 2–6 вещей на главной. Пусто — блок не показывается.
            </p>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Заголовок" value={st.capsuleOfWeek.title} onChange={(e) => set({ capsuleOfWeek: { ...st.capsuleOfWeek, title: e.target.value } })} placeholder="Капсула стоматолога" />
              <Field label="Текст" value={st.capsuleOfWeek.text} onChange={(e) => set({ capsuleOfWeek: { ...st.capsuleOfWeek, text: e.target.value } })} />
              <Picker items={d.capsule} max={6} onChange={(capsule) => setD({ ...d, capsule })} />
            </div>
          </section>
        </div>
        <div className={s.detailSide}>
          <section className={s.panel}>
            <h2>Премиум-баннер</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Заголовок" value={st.premium.title} error={errors['premium.title']} onChange={(e) => set({ premium: { ...st.premium, title: e.target.value } })} />
              <Field label="Текст" value={st.premium.text} onChange={(e) => set({ premium: { ...st.premium, text: e.target.value } })} />
              <Field label="Кнопка" value={st.premium.cta} onChange={(e) => set({ premium: { ...st.premium, cta: e.target.value } })} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
