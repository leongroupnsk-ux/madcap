'use client';

import { BUDGETS, CAPSULE_WEIGHTS, COLOR_TYPES, DEFAULT_CAPSULE_WEIGHTS, SHOE_SIZES, SIZES, capsuleWeightsSchema, type CapsuleWeightKey, type CapsuleWeights } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Group = { id: string; name: string; specialties: { id: string; name: string }[] };
type Item = { slot: string; title: string | null; brand: string | null; color: string | null; size: string | null; price: number | null; score: number | null };
type Result = { ms: number; variants: { variantNo: number; total: number; overBudget: boolean; explanations: string[]; items: Item[] }[] };

const SLOT: Record<string, string> = { top: 'Топ', pants: 'Брюки', gown: 'Халат', shoes: 'Обувь', accessory: 'Аксессуар' };
const rub = (k: number) => `${(k / 100).toLocaleString('ru-RU')} ₽`;
const asText = (w: CapsuleWeights) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, String(v)])) as Record<CapsuleWeightKey, string>;

/** Подбор (ТЗ §8): веса скоринга капсулы и пробный прогон анкеты без сохранения. */
export default function AdminCapsulePage() {
  const [weights, setWeights] = useState<Record<CapsuleWeightKey, string> | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [quiz, setQuiz] = useState({ gender: 'female', heightCm: '170', sizeTop: 'M', sizeBottom: 'M', sizeShoes: '38', colorType: 'summer', budgetRange: '10_15', specialtyIds: [] as string[] });
  const [result, setResult] = useState<Result | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    api<CapsuleWeights>('/admin/capsule/weights').then((w) => setWeights(asText(w))).catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
    api<{ specialtyGroups: Group[] }>('/dictionaries').then((d) => setGroups(d.specialtyGroups));
  }, []);
  if (!weights) return msg ? <Alert tone="error">{msg.text}</Alert> : null;

  const parsed = () => {
    const r = capsuleWeightsSchema.safeParse(weights);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      setMsg({ tone: 'error', text: 'Проверьте веса' });
      return null;
    }
    setErrors({});
    return r.data;
  };
  const call = async <T,>(fn: () => Promise<T>, ok?: string) => {
    setMsg(null);
    try {
      const r = await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      return r;
    } catch (e) {
      setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Нет связи с сервером' });
      return null;
    }
  };
  const save = async () => {
    const w = parsed();
    if (!w) return;
    const r = await call(() => api<CapsuleWeights>('/admin/capsule/weights', w, 'PUT'), 'Веса сохранены — применятся при следующей сборке капсул');
    if (r) setWeights(asText(r));
  };
  const tryRun = async () => {
    const w = parsed();
    if (!w) return;
    if (!quiz.specialtyIds.length) return setMsg({ tone: 'error', text: 'Выберите специальность' });
    const r = await call(() => api<Result>('/admin/capsule/try', { ...quiz, weights: w }));
    if (r) setResult(r);
  };
  const sel = (key: keyof typeof quiz, label: string, options: readonly (readonly [string, string])[]) => (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className={s.muted}>{label}</span>
      <select className={s.input} value={quiz[key] as string} onChange={(e) => setQuiz({ ...quiz, [key]: e.target.value })}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Подбор капсулы</h1>
        </div>
        <div className={s.actions}>
          <Button variant="ghost" onClick={() => setWeights(asText(DEFAULT_CAPSULE_WEIGHTS))}>
            Значения по умолчанию
          </Button>
          <Button onClick={save}>Сохранить веса</Button>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={s.detail} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <section className={s.panel}>
            <h2>Пробный прогон</h2>
            <p className={s.muted} style={{ marginBottom: 10 }}>
              Анкета покупателя без сохранения. Считается с весами из формы справа — даже несохранёнными.
            </p>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {sel('gender', 'Пол', [['female', 'Женский'], ['male', 'Мужской']])}
              <Field label="Рост, см" type="number" value={quiz.heightCm} onChange={(e) => setQuiz({ ...quiz, heightCm: e.target.value })} />
              {sel('sizeTop', 'Размер верха', SIZES.map((x) => [x, x] as const))}
              {sel('sizeBottom', 'Размер низа', SIZES.map((x) => [x, x] as const))}
              {sel('sizeShoes', 'Обувь', SHOE_SIZES.map((x) => [x, x] as const))}
              {sel('colorType', 'Цветотип', Object.entries(COLOR_TYPES).map(([k, v]) => [k, v.label] as const))}
              {sel('budgetRange', 'Бюджет', BUDGETS.map((b) => [b.id, b.label] as const))}
            </div>
            <div style={{ marginTop: 12 }}>
              <span className={s.muted}>Специальности</span>
              <div className={s.chips} style={{ marginTop: 6 }}>
                {groups.flatMap((g) => g.specialties).map((sp) => {
                  const on = quiz.specialtyIds.includes(sp.id);
                  return (
                    <label key={sp.id} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 14 }}>
                      <input type="checkbox" checked={on} onChange={() => setQuiz({ ...quiz, specialtyIds: on ? quiz.specialtyIds.filter((x) => x !== sp.id) : [...quiz.specialtyIds, sp.id] })} />
                      {sp.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Button onClick={tryRun}>Собрать капсулу</Button>
            </div>
          </section>
          {result && (
            <>
              <p className={s.muted}>Расчёт занял {result.ms} мс.{!result.variants.length && ' Подходящих товаров нет — проверьте размеры, ростовку и наличие.'}</p>
              {result.variants.map((v) => (
                <section key={v.variantNo} className={`${s.panel} ${s.scroll}`}>
                  <h2>
                    Вариант {v.variantNo} · {rub(v.total)}
                    {v.overBudget && <span className={s.muted}> · не уложились в бюджет</span>}
                  </h2>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th scope="col">Слот</th>
                        <th scope="col">Товар</th>
                        <th scope="col">Цвет, размер</th>
                        <th scope="col">Цена</th>
                        <th scope="col">Оценка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.items.map((i) => (
                        <tr key={i.slot}>
                          <td>{SLOT[i.slot] ?? i.slot}</td>
                          <td>{i.title ? <>{i.title} <span className={s.muted}>· {i.brand}</span></> : <span className={s.muted}>не подобрано</span>}</td>
                          <td className={s.muted}>{i.color ? `${i.color}, ${i.size}` : ''}</td>
                          <td>{i.price != null ? rub(i.price) : ''}</td>
                          <td>{i.score ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {v.explanations.length > 0 && <p className={s.muted} style={{ marginTop: 10 }}>{v.explanations.join(' · ')}</p>}
                </section>
              ))}
            </>
          )}
        </div>
        <div className={s.detailSide}>
          <section className={s.panel}>
            <h2>Веса скоринга</h2>
            <p className={s.muted} style={{ marginBottom: 10 }}>
              Баллы, которые получает вещь за признак. От −10 до 10.
            </p>
            <div style={{ display: 'grid', gap: 12 }}>
              {(Object.keys(CAPSULE_WEIGHTS) as CapsuleWeightKey[]).map((k) => (
                <Field key={k} label={CAPSULE_WEIGHTS[k].label} type="number" step="0.5" value={weights[k]} error={errors[k]} hint={`По умолчанию ${CAPSULE_WEIGHTS[k].def}`} onChange={(e) => setWeights({ ...weights, [k]: e.target.value })} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
