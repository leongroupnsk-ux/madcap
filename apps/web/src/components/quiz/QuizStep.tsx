'use client';

import { BUDGETS, COLOR_TYPES, MAX_PROFILE_PHOTOS, PHOTO_ANGLES, QUIZ_STEPS, SHOE_SIZES, SIZES, bodyTypeOf, colorTypeOf } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { Button, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { Dictionaries } from '@/lib/types';
import s from './quiz.module.css';
import { useQuiz, type QuizData } from './useQuiz';

const TITLES = ['Для кого подбираем?', 'Ваши параметры', 'Определим ваш цветотип', 'Ваша специальность', 'Сколько вы готовы потратить?', 'Покажите себя'];
const LEADS = [
  'Учитываем посадку и размерную сетку брендов.',
  'Достаточно приблизительных значений — они помогут определить посадку.',
  'Несколько простых вопросов помогут подобрать подходящую палитру.',
  'От специальности зависят требования к ткани, крою и обработке. Вы можете выбрать несколько вариантов.',
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
      <Link href="/" className={s.logo} aria-label="aesculap — на главную">
        <Logo size={20} />
      </Link>
      {/* Счётчик «N из 6» идёт по шагу: в макете он застыл на «1 из 6» — ошибка макета (ТЗ §12 п.12). */}
      <div className={s.progressHead}>
        <span>АНКЕТА ПРОФИЛЯ</span>
        <span>{step} из 6</span>
      </div>
      <div className={s.bar} role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step} aria-label="Прогресс анкеты">
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
          <Button className={s.cta} onClick={() => next()} disabled={busy}>
            {step === 6 ? 'Продолжить →' : 'Далее →'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Кнопка-вариант (пилюля) из макета: выбранная — тёмно-зелёная. */
function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} className={`${s.option} ${on ? s.optionOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

type StepProps = { d: QuizData; set: (p: QuizData) => void; errors?: Record<string, string> };

function Step1({ d, set, errors = {} }: StepProps) {
  return (
    <>
      <div className={s.section}>
        <div className={s.options} role="group" aria-label="Для кого подбираем">
          <Option on={d.gender === 'female'} onClick={() => set({ gender: 'female' })}>
            Женский
          </Option>
          <Option on={d.gender === 'male'} onClick={() => set({ gender: 'male' })}>
            Мужской
          </Option>
        </div>
        {errors.gender && <p className={s.error}>{errors.gender}</p>}
      </div>
      <div className={`${s.section} ${s.grid2}`}>
        <label className={s.field}>
          <span className={s.label}>Имя</span>
          <input className={s.input} value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoComplete="given-name" />
          {errors.name && <p className={s.error}>{errors.name}</p>}
        </label>
        <label className={s.field}>
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
      <div className={`${s.section} ${s.grid2}`}>
        <label className={s.field}>
          <span className={s.label}>Рост, см</span>
          <input className={s.input} inputMode="numeric" value={d.heightCm ?? ''} onChange={(e) => set({ heightCm: num(e.target.value) })} />
          {errors.heightCm && <p className={s.error}>{errors.heightCm}</p>}
        </label>
        <label className={s.field}>
          <span className={s.label}>Вес, кг</span>
          <input className={s.input} inputMode="numeric" value={d.weightKg ?? ''} onChange={(e) => set({ weightKg: num(e.target.value) })} />
        </label>
      </div>
      <div className={`${s.sectionTight} ${s.grid3}`}>
        {(
          [
            ['sizeTop', 'Размер верха', SIZES],
            ['sizeBottom', 'Размер низа', SIZES],
            ['sizeShoes', 'Размер обуви', SHOE_SIZES],
          ] as const
        ).map(([key, label, opts]) => (
          <label key={key} className={s.field}>
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
      <div className={s.sectionTight}>
        <button type="button" className={s.sizeBtn} onClick={() => setChart(true)}>
          Не знаю свой размер
        </button>
      </div>
      {body && (
        <div className={s.section}>
          <div className={s.hintBox}>
            Предварительный тип фигуры: <b>{body}</b>
          </div>
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
    <div className={s.question} role="group" aria-label={label}>
      <p className={s.monoLabel}>{label}</p>
      <div className={s.options}>
        {opts.map(([v, l]) => (
          <Option key={v} on={d[key] === v} onClick={() => set({ [key]: v } as QuizData)}>
            {l}
          </Option>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className={s.section}>
        {row('Тон кожи', 'skinTone', [['warm', 'Тёплый'], ['cold', 'Холодный']])}
        {row('Цвет волос', 'hair', [['light', 'Светлые'], ['dark', 'Тёмные']])}
        {row('Цвет глаз', 'eyes', [['light', 'Светлые'], ['dark', 'Тёмные']])}
      </div>
      {ct && (
        <div className={s.section}>
          <div className={s.hintBox}>
            Ваш цветотип: <b>{COLOR_TYPES[ct].label}</b> · используем его для подбора подходящих цветов одежды.
          </div>
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
  const card = (g: (typeof matches)[number], order: number) => {
    const isOpen = open === g.id || term.trim().length > 0;
    const count = g.specialties.filter((sp) => selected.includes(sp.id)).length;
    return (
      <div key={g.id} className={`${s.group} ${isOpen ? s.groupOpen : ''}`} style={{ order }}>
        <button type="button" className={s.groupHead} onClick={() => setOpen(isOpen && !term ? null : g.id)} aria-expanded={isOpen}>
          <span>
            {g.name}
            {count > 0 && ` · ${count}`}
          </span>
          <img src="/design/icons/quiz-chevron.svg" width={16} height={16} alt="" />
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
  };
  // Как в макете: две независимые колонки (раскрытая группа не растягивает соседнюю), порядок — через одну.
  return (
    <>
      <div className={s.search}>
        <img src="/design/icons/quiz-search.svg" width={20} height={20} alt="" />
        <input placeholder="Поиск специальности..." value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Поиск специальности" />
        {!term && <span className={s.searchHint}>Например, стоматолог, хирург, ассистент</span>}
      </div>
      <div className={s.groups}>
        <div className={s.groupCol}>{matches.map(card).filter((_, i) => i % 2 === 0)}</div>
        <div className={s.groupCol}>{matches.map(card).filter((_, i) => i % 2 === 1)}</div>
      </div>
      {errors.specialtyIds && <p className={s.error}>{errors.specialtyIds}</p>}
    </>
  );
}

function Step5({ d, set, errors = {} }: StepProps) {
  return (
    <div className={s.section}>
      <div className={s.budget} role="radiogroup" aria-label="Бюджет на капсулу">
        {BUDGETS.map((b) => (
          <button key={b.id} type="button" role="radio" aria-checked={d.budgetRange === b.id} className={d.budgetRange === b.id ? s.on : undefined} onClick={() => set({ budgetRange: b.id })}>
            {b.label}
          </button>
        ))}
      </div>
      {errors.budgetRange && <p className={s.error}>{errors.budgetRange}</p>}
    </div>
  );
}

const TIPS: [string, string, string][] = [
  ['camera', 'Качество', 'Чёткое, без размытия'],
  ['shirt', 'Одежда', 'Облегающая (леггинсы, футболка, топ)'],
  ['activity', 'Поза', 'Стоя, руки вдоль тела, ноги на ширине плеч'],
  ['sun', 'Освещение', 'Естественное (дневное) или мягкий свет'],
  ['footprints', 'Обувь', 'Босиком или в тонких носках'],
  ['scissors', 'Волосы', 'Убраны (для ракурса «спина»)'],
  ['image', 'Фон', 'Однотонный (белый, серый, бежевый)'],
];
/** Фото-примеры ракурсов из макета — public/design/quiz/angle-*.webp. */
const ANGLE_IMG: Record<string, string> = { front: 'front', side: 'side', back: 'back', three_quarter: 'three-quarter' };

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
      <div className={s.tipsWrap}>
        <div className={s.tips}>
          <div className={s.tipsHead}>
            <h2>Как сделать хорошее фото</h2>
            <button type="button" className={tipsOpen ? undefined : s.collapsed} onClick={() => setTipsOpen((v) => !v)} aria-expanded={tipsOpen}>
              {tipsOpen ? 'Свернуть' : 'Развернуть'}
              <img src="/design/icons/quiz-chevron-up.svg" width={16} height={16} alt="" />
            </button>
          </div>
          {tipsOpen && (
            <div className={s.tipsGrid}>
              {TIPS.map(([icon, t, h]) => (
                <div key={t} className={s.tip}>
                  <span className={s.tipIcon}>
                    <img src={`/design/icons/quiz-${icon}.svg`} width={icon === 'camera' ? 26.75 : 27} height={icon === 'camera' ? 22.25 : 27} alt="" />
                  </span>
                  <div>
                    <b>{t}</b>
                    <span>{h}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={s.anglesBlock}>
        <div>
          <h2 className={s.subhead}>Примеры ракурсов</h2>
          <p className={s.subnote}>Сделайте 3 основные фотографии. Четвёртый ракурс — по желанию.</p>
        </div>
        <div className={s.angles}>
          {PHOTO_ANGLES.map((a) => (
            <div key={a.id} className={s.angleCard}>
              <img src={`/design/quiz/angle-${ANGLE_IMG[a.id]}.webp`} width={166} height={253} alt={`Пример ракурса: ${a.label}`} loading="lazy" />
              <b>{a.label}</b>
              <span>{a.hint.replace(', ', ',\n')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.uploadBlock}>
        <h2 className={s.subhead}>Загрузите ваши фото</h2>
        {!q.authed ? (
          <div className={s.hintBox}>Фото можно добавить после создания профиля — нажмите «Пропустить», а в профиле загрузите позже.</div>
        ) : !consent ? (
          <div className={s.hintBox}>
            <label className={`${s.check} ${s.consent}`}>
              <input
                type="checkbox"
                onChange={async (e) => {
                  if (!e.target.checked) return;
                  const c = await api<Record<string, boolean>>('/me/consents', { type: 'photos', granted: true });
                  setConsent(c.photos);
                }}
              />
              <span>
                Согласен на обработку и хранение моих фото для подбора одежды по{' '}
                <a href="/legal/photos" target="_blank" rel="noreferrer">
                  условиям
                </a>
                . Фото видны только мне; удалить их можно в любой момент в профиле.
              </span>
            </label>
          </div>
        ) : (
          <div className={s.uploads}>
            {q.photos.map((p) => (
              <div key={p.id} className={s.photo}>
                <img src={p.url} alt="Ваше фото" />
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
                <i aria-hidden>+</i>
                {busy ? 'Загружаем…' : 'Добавить фото'}
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
      </div>
    </>
  );
}
