'use client';

import { BUDGETS, COLOR_TYPES, MAX_PROFILE_PHOTOS, PHOTO_ANGLES, QUIZ_STEPS, SHOE_SIZES, SIZES, bodyTypeOf, colorTypeOf } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import type { Dictionaries } from '@/lib/types';
import s from './quiz.module.css';
import { useQuiz, type QuizData } from './useQuiz';

const TITLES = ['Для кого подбираем?', 'Ваши параметры', 'Определим ваш цветотип', 'Ваша специальность', 'Сколько вы готовы потратить?', 'Покажите себя'];
const LEADS = [
  'Учитываем посадку и размерную сетку брендов.',
  'Достаточно приблизительных значений — они помогут определить посадку.',
  'Несколько простых вопросов помогут подобрать подходящую палитру.',
  'От специальности зависят требования к ткани, крою и обработке. Можно выбрать несколько вариантов.',
  '',
  'Добавьте от 1 до 3 фотографий в полный рост. Они помогут точнее подобрать для вас одежду.',
];
const SIZE_CHART: string[][] = [['42', 'XS', '86', '68', '92'], ['44', 'S', '88', '72', '96'], ['46', 'M', '92', '74', '98'], ['48', 'L', '96', '76', '100'], ['50', 'XL', '100', '80', '104'], ['52', 'XXL', '104', '84', '108'], ['54', 'XXXL', '108', '88', '112']];

export function QuizStep({ step, groups }: { step: number; groups: Dictionaries['specialtyGroups'] }) {
  const router = useRouter();
  const q = useQuiz();
  const [local, setLocal] = useState<QuizData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const d = { ...q.data, ...local };
  const set = (patch: QuizData) => {
    setLocal((l) => ({ ...(l ?? {}), ...patch }));
    // Ошибка поля пропадает, как только его поправили.
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
  };

  async function next(skip = false) {
    setErrors({});
    if (!skip) {
      const parsed = QUIZ_STEPS[step - 1].safeParse(d);
      if (!parsed.success) {
        const e: Record<string, string> = {};
        for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
        setErrors(e);
        return;
      }
    }
    setBusy(true);
    try {
      if (local) await q.save(local);
      router.push(step === 6 ? '/quiz/review' : `/quiz/${step + 1}`);
    } catch (e) {
      setErrors(isApiError(e) ? (e.errors ?? { _: e.message }) : { _: 'Нет связи с сервером' });
      setBusy(false);
    }
  }

  async function saveAndExit() {
    if (local) await q.save(local).catch(() => undefined);
    router.push(q.authed ? '/account' : '/');
  }

  if (!q.ready) return <div className={s.wrap} />;

  return (
    <div className={s.wrap}>
      <Link href="/" className={s.logo}>
        {BRAND.mark}
      </Link>
      <div className={s.progressHead}>
        <span>Анкета профиля</span>
        <span>
          {step} из 6
        </span>
      </div>
      <div className={s.bar} aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={i < step ? s.filled : undefined} />
        ))}
      </div>
      <div className={s.stepRow}>
        <span>Шаг 0{step}</span>
        <button type="button" onClick={saveAndExit}>
          Сохранить и выйти
        </button>
      </div>
      <h1 className={s.title}>{TITLES[step - 1]}</h1>
      {LEADS[step - 1] && <p className={s.lead}>{LEADS[step - 1]}</p>}
      {errors._ && <p className={s.error}>{errors._}</p>}

      {step === 1 && <Step1 d={d} set={set} errors={errors} />}
      {step === 2 && <Step2 d={d} set={set} errors={errors} />}
      {step === 3 && <Step3 d={d} set={set} />}
      {step === 4 && <Step4 d={d} set={set} errors={errors} groups={groups} />}
      {step === 5 && <Step5 d={d} set={set} errors={errors} />}
      {step === 6 && <Step6 q={q} />}

      <div className={s.nav}>
        {step > 1 ? (
          <button type="button" className={s.back} onClick={() => router.push(`/quiz/${step - 1}`)}>
            ← Назад
          </button>
        ) : (
          <Link href="/" className={s.back}>
            ← Назад
          </Link>
        )}
        <div className={s.navRight}>
          {(step === 3 || step === 6) && (
            <button type="button" className={s.skip} onClick={() => next(true)}>
              Пропустить
            </button>
          )}
          <Button onClick={() => next()} disabled={busy}>
            {step === 6 ? 'Продолжить →' : 'Далее →'}
          </Button>
        </div>
      </div>
    </div>
  );
}

type StepProps = { d: QuizData; set: (p: QuizData) => void; errors?: Record<string, string> };

function Step1({ d, set, errors = {} }: StepProps) {
  return (
    <>
      <div className={s.options}>
        <Chip active={d.gender === 'female'} onClick={() => set({ gender: 'female' })}>
          Женский
        </Chip>
        <Chip active={d.gender === 'male'} onClick={() => set({ gender: 'male' })}>
          Мужской
        </Chip>
      </div>
      {errors.gender && <p className={s.error}>{errors.gender}</p>}
      <div className={s.grid2}>
        <label>
          <span className={s.label}>Имя</span>
          <input className={s.input} value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoComplete="given-name" />
          {errors.name && <p className={s.error}>{errors.name}</p>}
        </label>
        <label>
          <span className={s.label}>Возраст</span>
          <input className={s.input} inputMode="numeric" value={d.age ?? ''} onChange={(e) => set({ age: Number(e.target.value.replace(/\D/g, '')) || null })} />
          {errors.age && <p className={s.error}>{errors.age}</p>}
        </label>
      </div>
    </>
  );
}

function Step2({ d, set, errors = {} }: StepProps) {
  const [chart, setChart] = useState(false);
  const body = bodyTypeOf(d.sizeTop, d.sizeBottom);
  const num = (v: string) => Number(v.replace(/\D/g, '')) || null;
  return (
    <>
      <div className={s.grid2}>
        <label>
          <span className={s.label}>Рост, см</span>
          <input className={s.input} inputMode="numeric" value={d.heightCm ?? ''} onChange={(e) => set({ heightCm: num(e.target.value) })} />
          {errors.heightCm && <p className={s.error}>{errors.heightCm}</p>}
        </label>
        <label>
          <span className={s.label}>Вес, кг</span>
          <input className={s.input} inputMode="numeric" value={d.weightKg ?? ''} onChange={(e) => set({ weightKg: num(e.target.value) })} />
        </label>
      </div>
      <div className={s.grid3}>
        {(
          [
            ['sizeTop', 'Размер верха', SIZES],
            ['sizeBottom', 'Размер низа', SIZES],
            ['sizeShoes', 'Размер обуви', SHOE_SIZES],
          ] as const
        ).map(([key, label, opts]) => (
          <label key={key}>
            <span className={s.label}>{label}</span>
            <select className={s.select} value={d[key] ?? ''} onChange={(e) => set({ [key]: e.target.value || null })}>
              <option value="">Выберите размер</option>
              {opts.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            {errors[key] && <p className={s.error}>{errors[key]}</p>}
          </label>
        ))}
      </div>
      <button type="button" className={s.linkBtn} onClick={() => setChart(true)}>
        Не знаю свой размер
      </button>
      {body && (
        <div className={s.hintBox}>
          Предварительный тип фигуры: <b>{body}</b>
        </div>
      )}
      {chart && (
        <Modal eyebrow="Информация" title="Таблица размеров" onClose={() => setChart(false)}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: 14 }}>
              <thead>
                <tr>
                  {['Российский', 'Международный', 'Обхват груди, см', 'Обхват талии, см', 'Обхват бёдер, см'].map((h) => (
                    <th key={h} style={{ border: '1px solid var(--c-border-strong)', padding: 8 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SIZE_CHART.map((r) => (
                  <tr key={r[0]}>
                    {r.map((c, i) => (
                      <td key={i} style={{ border: '1px solid var(--c-border-strong)', padding: 8 }}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

function Step3({ d, set }: StepProps) {
  const ct = colorTypeOf(d.skinTone, d.hair);
  const row = (label: string, key: 'skinTone' | 'hair' | 'eyes', opts: [string, string][]) => (
    <>
      <span className={s.label}>{label}</span>
      <div className={s.options}>
        {opts.map(([v, l]) => (
          <Chip key={v} active={d[key] === v} onClick={() => set({ [key]: v } as QuizData)}>
            {l}
          </Chip>
        ))}
      </div>
    </>
  );
  return (
    <>
      {row('Тон кожи', 'skinTone', [['warm', 'Тёплый'], ['cold', 'Холодный']])}
      {row('Цвет волос', 'hair', [['light', 'Светлые'], ['dark', 'Тёмные']])}
      {row('Цвет глаз', 'eyes', [['light', 'Светлые'], ['dark', 'Тёмные']])}
      {ct && (
        <div className={s.hintBox}>
          Ваш цветотип: <b>{COLOR_TYPES[ct].label}</b> — используем его для подбора подходящих цветов одежды.
        </div>
      )}
    </>
  );
}

function Step4({ d, set, errors = {}, groups }: StepProps & { groups: Dictionaries['specialtyGroups'] }) {
  const selected = d.specialtyIds ?? [];
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(() => groups.find((g) => g.specialties.some((sp) => selected.includes(sp.id)))?.id ?? null);
  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? groups.map((g) => ({ ...g, specialties: g.specialties.filter((sp) => sp.name.toLowerCase().includes(t)) })).filter((g) => g.specialties.length) : groups;
  }, [groups, term]);
  const toggle = (id: string) => set({ specialtyIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  return (
    <>
      <div className={s.search}>
        <input placeholder="Поиск специальности… например, стоматолог, хирург, ассистент" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Поиск специальности" />
      </div>
      <div className={s.groups}>
        {matches.map((g) => {
          const isOpen = open === g.id || term.trim().length > 0;
          const count = g.specialties.filter((sp) => selected.includes(sp.id)).length;
          return (
            <div key={g.id} className={`${s.group} ${isOpen ? s.groupOpen : ''}`}>
              <button type="button" className={s.groupHead} onClick={() => setOpen(isOpen && !term ? null : g.id)} aria-expanded={isOpen}>
                <span>
                  {g.name}
                  {count > 0 && ` · ${count}`}
                </span>
                <span aria-hidden>{isOpen ? '▴' : '▾'}</span>
              </button>
              {isOpen && (
                <div className={s.groupBody}>
                  {g.specialties.map((sp) => (
                    <label key={sp.id} className={s.check}>
                      <input type="checkbox" checked={selected.includes(sp.id)} onChange={() => toggle(sp.id)} />
                      {sp.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {errors.specialtyIds && <p className={s.error}>{errors.specialtyIds}</p>}
    </>
  );
}

function Step5({ d, set, errors = {} }: StepProps) {
  return (
    <>
      <div className={s.budget} role="radiogroup" aria-label="Бюджет на капсулу">
        {BUDGETS.map((b) => (
          <button key={b.id} type="button" role="radio" aria-checked={d.budgetRange === b.id} className={d.budgetRange === b.id ? s.on : undefined} onClick={() => set({ budgetRange: b.id })}>
            {b.label}
          </button>
        ))}
      </div>
      {errors.budgetRange && <p className={s.error}>{errors.budgetRange}</p>}
    </>
  );
}

/** Фото — только после входа и с отдельным согласием (ТЗ §5.1, §11). */
function Step6({ q }: { q: ReturnType<typeof useQuiz> }) {
  const [tipsOpen, setTipsOpen] = useState(true);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextAngle = PHOTO_ANGLES.map((a) => a.id).find((id) => !q.photos.some((p) => p.angle === id)) ?? 'three_quarter';

  useEffect(() => {
    if (q.authed) api<Record<string, boolean>>('/me/consents').then((c) => setConsent(c.photos)).catch(() => setConsent(false));
  }, [q.authed]);

  return (
    <>
      <div className={s.tips}>
        <div className={s.tipsHead}>
          Как сделать хорошее фото
          <button type="button" onClick={() => setTipsOpen((v) => !v)}>
            {tipsOpen ? 'Свернуть ▴' : 'Развернуть ▾'}
          </button>
        </div>
        {tipsOpen && (
          <div className={s.tipsGrid}>
            {[
              ['Качество', 'Чёткое, без размытия'],
              ['Одежда', 'Облегающая (леггинсы, футболка, топ)'],
              ['Поза', 'Стоя, руки вдоль тела, ноги на ширине плеч'],
              ['Освещение', 'Естественное (дневное) или мягкий свет'],
              ['Обувь', 'Босиком или в тонких носках'],
              ['Фон', 'Однотонный (белый, серый, бежевый)'],
            ].map(([t, h]) => (
              <div key={t}>
                <b>{t}</b>
                <span>{h}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className={s.label}>Примеры ракурсов</span>
      <div className={s.angles}>
        {PHOTO_ANGLES.map((a) => (
          <div key={a.id}>
            <div className={s.angle}>{a.label.split(' ')[0]}</div>
            <b>{a.label}</b>
            <span>{a.hint}</span>
          </div>
        ))}
      </div>

      <span className={s.label}>Загрузите ваши фото</span>
      {!q.authed ? (
        <div className={s.hintBox}>
          Фото можно добавить после создания профиля — нажмите «Пропустить», а в профиле загрузите позже.
        </div>
      ) : !consent ? (
        <div className={s.hintBox}>
          <label className={s.check} style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              onChange={async (e) => {
                if (!e.target.checked) return;
                const c = await api<Record<string, boolean>>('/me/consents', { type: 'photos', granted: true });
                setConsent(c.photos);
              }}
            />
            <span>
              Согласен на обработку и хранение моих фото для подбора одежды по <a href="/legal/photos" target="_blank" rel="noreferrer">условиям</a>. Фото видны только мне; удалить их можно в любой момент в профиле.
            </span>
          </label>
        </div>
      ) : (
        <div className={s.uploads}>
          {q.photos.map((p) => (
            <div key={p.id} className={s.photo}>
              <img src={p.url} alt="" />
              <button
                type="button"
                aria-label="Удалить фото"
                onClick={async () => {
                  const res = await api<{ photos: typeof q.photos }>(`/me/photos/${p.id}`, undefined, 'DELETE');
                  q.setPhotos(res.photos);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {q.photos.length < MAX_PROFILE_PHOTOS && (
            <button type="button" className={s.addPhoto} disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Загружаем…' : '+ Добавить фото'}
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                const form = new FormData();
                form.append('file', file);
                form.append('angle', nextAngle);
                const res = await api<{ photos: typeof q.photos }>('/me/photos', form);
                q.setPhotos(res.photos);
              } catch (err) {
                setError(isApiError(err) ? err.message : 'Не удалось загрузить фото');
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
      {error && <p className={s.error}>{error}</p>}
    </>
  );
}
