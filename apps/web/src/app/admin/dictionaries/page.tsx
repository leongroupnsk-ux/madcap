'use client';

import { CAPSULE_SLOTS, COLOR_FAMILIES, DEFAULT_SIZE_CHART } from '@aesculap/shared';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Chip, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Table = { columns: string[]; rows: string[][] };
type Data = {
  categories: { id: string; name: string; slug: string; parentId: string | null; slot: string | null; position: number; products: number; children: number }[];
  specialtyGroups: { id: string; name: string; position: number; specialties: { id: string; name: string; slug: string; position: number; slots: string[]; products: number; profiles: number }[] }[];
  colors: { id: string; name: string; hex: string; colorFamily: string; variants: number }[];
  brands: { id: string; name: string; slug: string; sizeChart: { clothes: Table; shoes: Table } | null; products: number }[];
};
type Tab = 'categories' | 'specialties' | 'colors' | 'brands';
type Edit =
  | { kind: 'category'; id?: string; name: string; slug: string; parentId: string; slot: string; position: string }
  | { kind: 'group'; id?: string; name: string; position: string }
  | { kind: 'specialty'; id?: string; name: string; slug: string; groupId: string; slots: string[]; position: string }
  | { kind: 'color'; id?: string; name: string; hex: string; colorFamily: string }
  | { kind: 'brand'; id: string; name: string; clothes: string; shoes: string; mergeInto: string };

const SLOT_NAMES = CAPSULE_SLOTS as Record<string, string>;
const toText = (t: Table) => [t.columns, ...t.rows].map((r) => r.join('; ')).join('\n');
const fromText = (text: string): Table | null => {
  const lines = text.split('\n').map((l) => l.split(';').map((c) => c.trim())).filter((r) => r.some(Boolean));
  return lines.length ? { columns: lines[0], rows: lines.slice(1) } : null;
};

/** Каталог и справочники (ТЗ §8): категории, специальности и слоты капсулы, цвета и палитры, бренды и таблицы размеров. */
export default function AdminDictionariesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('categories');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<Data>('/admin/dictionaries').then(setData).catch((e) => setError(isApiError(e) ? e.message : 'Ошибка')), []);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<Data>) => {
    setError(null);
    setErrors({});
    try {
      setData(await fn());
      setEdit(null);
    } catch (e) {
      if (isApiError(e)) {
        setErrors(e.errors ?? {});
        setError(e.message);
      } else setError('Нет связи с сервером');
    }
  };
  const remove = (path: string, title: string) => confirm(`Удалить «${title}»?`) && run(() => api<Data>(`/admin/dictionaries/${path}`, undefined, 'DELETE'));

  const save = () => {
    if (!edit) return;
    const req = (path: string, body: object, id?: string) => run(() => api<Data>(`/admin/dictionaries/${path}${id ? `/${id}` : ''}`, body, id ? 'PUT' : 'POST'));
    if (edit.kind === 'category') return req('categories', { name: edit.name, slug: edit.slug, parentId: edit.parentId || null, slot: edit.slot || null, position: edit.position }, edit.id);
    if (edit.kind === 'group') return req('specialty-groups', { name: edit.name, position: edit.position }, edit.id);
    if (edit.kind === 'specialty') return req('specialties', { name: edit.name, slug: edit.slug, groupId: edit.groupId, slots: edit.slots, position: edit.position }, edit.id);
    if (edit.kind === 'color') return req('colors', { name: edit.name, hex: edit.hex, colorFamily: edit.colorFamily }, edit.id);
    const clothes = fromText(edit.clothes);
    const shoes = fromText(edit.shoes);
    return req('brands', { name: edit.name, sizeChart: clothes && shoes ? { clothes, shoes } : null }, edit.id);
  };

  if (!data) return error ? <Alert tone="error">{error}</Alert> : null;
  const roots = data.categories.filter((c) => !c.parentId);
  const set = (patch: Partial<Edit>) => setEdit((e) => (e ? ({ ...e, ...patch } as Edit) : e));

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Справочники</h1>
        </div>
      </div>
      <div className={s.chips}>
        {(
          [
            ['categories', `Категории · ${data.categories.length}`],
            ['specialties', `Специальности · ${data.specialtyGroups.reduce((n, g) => n + g.specialties.length, 0)}`],
            ['colors', `Цвета · ${data.colors.length}`],
            ['brands', `Бренды · ${data.brands.length}`],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} active={tab === id} onClick={() => setTab(id)}>
            {label}
          </Chip>
        ))}
      </div>
      {error && !edit && <Alert tone="error">{error}</Alert>}

      {tab === 'categories' && (
        <section className={`${s.panel} ${s.scroll}`}>
          <div className={s.head} style={{ marginBottom: 8 }}>
            <p className={s.muted}>Слот капсулы связывает категорию с подбором: из категорий со слотом «Топ» берутся топы и т. д.</p>
            <Button onClick={() => setEdit({ kind: 'category', name: '', slug: '', parentId: '', slot: '', position: '0' })}>Добавить</Button>
          </div>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Категория</th>
                <th scope="col">Адрес</th>
                <th scope="col">Слот капсулы</th>
                <th scope="col">Товаров</th>
                <th scope="col" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {roots.flatMap((r) => [r, ...data.categories.filter((c) => c.parentId === r.id)]).map((c) => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: c.parentId ? 32 : 12 }}>{c.parentId ? `↳ ${c.name}` : <b>{c.name}</b>}</td>
                  <td className={s.muted}>/catalog/{c.slug}</td>
                  <td>{c.slot ? SLOT_NAMES[c.slot] : <span className={s.muted}>—</span>}</td>
                  <td>{c.products}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className={s.actions}>
                      <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setEdit({ kind: 'category', id: c.id, name: c.name, slug: c.slug, parentId: c.parentId ?? '', slot: c.slot ?? '', position: String(c.position) })}>
                        Изменить
                      </button>
                      {!c.products && !c.children && (
                        <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => remove(`categories/${c.id}`, c.name)}>
                          Удалить
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'specialties' && (
        <section className={s.panel}>
          <div className={s.head} style={{ marginBottom: 8 }}>
            <p className={s.muted}>Слоты специальности задают состав капсулы. Пусто — стандартный набор: топ, брюки, халат, обувь, аксессуар.</p>
            <div className={s.actions}>
              <Button variant="outline" onClick={() => setEdit({ kind: 'group', name: '', position: '0' })}>
                Группа
              </Button>
              <Button onClick={() => setEdit({ kind: 'specialty', name: '', slug: '', groupId: data.specialtyGroups[0]?.id ?? '', slots: [], position: '0' })}>Специальность</Button>
            </div>
          </div>
          {data.specialtyGroups.map((g) => (
            <div key={g.id} style={{ marginTop: 16 }}>
              <div className={s.actions} style={{ alignItems: 'center' }}>
                <b>{g.name}</b>
                <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setEdit({ kind: 'group', id: g.id, name: g.name, position: String(g.position) })}>
                  Изменить
                </button>
                {!g.specialties.length && (
                  <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => remove(`specialty-groups/${g.id}`, g.name)}>
                    Удалить
                  </button>
                )}
              </div>
              <table className={s.table} style={{ marginTop: 6 }}>
                <tbody>
                  {g.specialties.map((sp) => (
                    <tr key={sp.id}>
                      <td>{sp.name}</td>
                      <td className={s.muted}>{sp.slots.length ? sp.slots.map((x) => SLOT_NAMES[x]).join(', ') : 'стандартный набор'}</td>
                      <td className={s.muted}>
                        товаров {sp.products} · анкет {sp.profiles}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div className={s.actions}>
                          <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setEdit({ kind: 'specialty', id: sp.id, name: sp.name, slug: sp.slug, groupId: g.id, slots: sp.slots, position: String(sp.position) })}>
                            Изменить
                          </button>
                          {!sp.products && !sp.profiles && (
                            <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => remove(`specialties/${sp.id}`, sp.name)}>
                              Удалить
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {tab === 'colors' && (
        <section className={`${s.panel} ${s.scroll}`}>
          <div className={s.head} style={{ marginBottom: 8 }}>
            <p className={s.muted}>Семейство цвета определяет, каким цветотипам он подходит при подборе капсулы.</p>
            <Button onClick={() => setEdit({ kind: 'color', name: '', hex: '#', colorFamily: 'neutral-light' })}>Добавить</Button>
          </div>
          <table className={s.table}>
            <tbody>
              {data.colors.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 9, background: c.hex, border: '1px solid var(--c-border)', verticalAlign: 'middle', marginRight: 8 }} />
                    {c.name}
                  </td>
                  <td className={s.muted}>{c.hex}</td>
                  <td>{COLOR_FAMILIES[c.colorFamily as keyof typeof COLOR_FAMILIES] ?? c.colorFamily}</td>
                  <td className={s.muted}>вариантов {c.variants}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className={s.actions}>
                      <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setEdit({ kind: 'color', id: c.id, name: c.name, hex: c.hex, colorFamily: c.colorFamily })}>
                        Изменить
                      </button>
                      {!c.variants && (
                        <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => remove(`colors/${c.id}`, c.name)}>
                          Удалить
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'brands' && (
        <section className={`${s.panel} ${s.scroll}`}>
          <p className={s.muted} style={{ marginBottom: 8 }}>
            Бренды добавляют поставщики. Дубли объединяйте — товары переедут к выбранному бренду. Таблица размеров бренда показывается на странице товара.
          </p>
          <table className={s.table}>
            <tbody>
              {data.brands.map((b) => (
                <tr key={b.id}>
                  <td>
                    <b>{b.name}</b>
                  </td>
                  <td className={s.muted}>товаров {b.products}</td>
                  <td className={s.muted}>{b.sizeChart ? 'своя таблица размеров' : 'стандартная таблица'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className={s.actions}>
                      <button
                        className={s.link}
                        style={{ border: 0, background: 'none', cursor: 'pointer' }}
                        onClick={() =>
                          setEdit({ kind: 'brand', id: b.id, name: b.name, clothes: toText((b.sizeChart ?? DEFAULT_SIZE_CHART).clothes), shoes: toText((b.sizeChart ?? DEFAULT_SIZE_CHART).shoes), mergeInto: '' })
                        }
                      >
                        Изменить
                      </button>
                      {!b.products && (
                        <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => remove(`brands/${b.id}`, b.name)}>
                          Удалить
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {edit && (
        <Modal eyebrow="Справочник" title={edit.id ? 'Изменить' : 'Добавить'} onClose={() => setEdit(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Название" value={edit.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} />
            {(edit.kind === 'category' || edit.kind === 'specialty') && (
              <Field label="Адрес (slug)" value={edit.slug} error={errors.slug} placeholder="заполнится из названия" onChange={(e) => set({ slug: e.target.value })} />
            )}
            {edit.kind === 'category' && (
              <>
                <label className={s.muted}>
                  Раздел
                  <select className={s.input} style={{ width: '100%', marginTop: 4 }} value={edit.parentId} onChange={(e) => set({ parentId: e.target.value })}>
                    <option value="">— верхний уровень —</option>
                    {roots.filter((r) => r.id !== edit.id).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={s.muted}>
                  Слот капсулы
                  <select className={s.input} style={{ width: '100%', marginTop: 4 }} value={edit.slot} onChange={(e) => set({ slot: e.target.value })}>
                    <option value="">— не участвует в подборе —</option>
                    {Object.entries(CAPSULE_SLOTS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {edit.kind === 'specialty' && (
              <>
                <label className={s.muted}>
                  Группа
                  <select className={s.input} style={{ width: '100%', marginTop: 4 }} value={edit.groupId} onChange={(e) => set({ groupId: e.target.value })}>
                    {data.specialtyGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <div className={s.muted} style={{ marginBottom: 6 }}>
                    Состав капсулы (пусто — стандартный)
                  </div>
                  <div className={s.chips}>
                    {Object.entries(CAPSULE_SLOTS).map(([id, label]) => (
                      <Chip key={id} active={edit.slots.includes(id)} onClick={() => set({ slots: edit.slots.includes(id) ? edit.slots.filter((x) => x !== id) : [...edit.slots, id] })}>
                        {label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </>
            )}
            {edit.kind === 'color' && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Field label="HEX" value={edit.hex} error={errors.hex} onChange={(e) => set({ hex: e.target.value })} />
                  </div>
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(edit.hex) ? edit.hex : '#ffffff'} onChange={(e) => set({ hex: e.target.value })} aria-label="Выбрать цвет" style={{ width: 48, height: 44, border: 0, background: 'none' }} />
                </div>
                <label className={s.muted}>
                  Семейство для палитр цветотипов
                  <select className={s.input} style={{ width: '100%', marginTop: 4 }} value={edit.colorFamily} onChange={(e) => set({ colorFamily: e.target.value })}>
                    {Object.entries(COLOR_FAMILIES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(edit.kind === 'category' || edit.kind === 'group' || edit.kind === 'specialty') && (
              <Field label="Порядок" type="number" value={edit.position} onChange={(e) => set({ position: e.target.value })} />
            )}
            {edit.kind === 'brand' && (
              <>
                <p className={s.muted}>Таблица размеров: первая строка — заголовки, ячейки через «;».</p>
                <label className={s.muted}>
                  Одежда
                  <textarea className={s.input} style={{ width: '100%', height: 140, padding: 8, marginTop: 4, fontFamily: 'monospace' }} value={edit.clothes} onChange={(e) => set({ clothes: e.target.value })} />
                </label>
                <label className={s.muted}>
                  Обувь
                  <textarea className={s.input} style={{ width: '100%', height: 110, padding: 8, marginTop: 4, fontFamily: 'monospace' }} value={edit.shoes} onChange={(e) => set({ shoes: e.target.value })} />
                </label>
                <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}>
                  <div className={s.muted} style={{ marginBottom: 6 }}>
                    Объединить с другим брендом (этот будет удалён, товары переедут)
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className={s.input} style={{ flex: 1 }} value={edit.mergeInto} onChange={(e) => set({ mergeInto: e.target.value })} aria-label="Бренд для объединения">
                      <option value="">— выберите —</option>
                      {data.brands.filter((b) => b.id !== edit.id).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      disabled={!edit.mergeInto}
                      onClick={() => confirm('Объединить бренды? Это нельзя отменить.') && run(() => api<Data>(`/admin/dictionaries/brands/${edit.id}/merge`, { intoId: edit.mergeInto }))}
                    >
                      Объединить
                    </Button>
                  </div>
                </div>
              </>
            )}
            <Button onClick={save}>Сохранить</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
