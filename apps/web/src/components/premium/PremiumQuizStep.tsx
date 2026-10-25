'use client';

import { COLOR_TYPES, MAX_PROFILE_PHOTOS, PREMIUM_BUDGETS, PREMIUM_QUIZ_STEPS, SHOE_SIZES, SIZES, bodyTypeOf, colorTypeOf, premiumCompleteSchema, type PremiumAnswers } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, isApiError } from '@/lib/api';
import type { Dictionaries } from '@/lib/types';
import { PremiumLogo } from './PremiumLogo';
import s from './premium.module.css';
import { usePremiumQuiz } from './usePremiumQuiz';

type Groups = Dictionaries['specialtyGroups'];
const TITLES = ['Для кого подбираем?', 'Ваши параметры', 'Определим ваш цветотип', 'Где вы работаете?', 'Сколько вы готовы потратить?', 'Покажите себя'];
const LEADS = [
  'Учитываем посадку и размерную сетку брендов.',
  'Достаточно приблизительных значений - они помогут определить посадку.',
  'Несколько простых вопросов помогут подобрать подходящую палитру.',
  'От специальности зависят требования к ткани, крою и обработке.',
  '',
  'Добавьте от 1 до 3 фотографий. Они помогают уточнить рекомендации, но не заменяют примерку.',
];
const STEPS = 6;
const PHOTO_SLOTS = 3;

/** Шаги 1–6 премиум-анкеты (кадры .Premium-Quiz-1…6) */
export function PremiumQuizStep({ step, groups }: { step: number; groups: Groups }) {
  const router = useRouter();
  const q = usePremiumQuiz();
  const [local, setLocal] = useState<PremiumAnswers | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const d = { ...q.answers, ...local };
  const set = (patch: PremiumAnswers) => {
    setLocal((l) => ({ ...(l ?? {}), ...patch }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
  };

  async function next(skip = false) {
    setErrors({});
    if (!skip) {
      const parsed = PREMIUM_QUIZ_STEPS[step - 1].safeParse(d);
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
      router.push(`/premium/quiz/${step + 1}`);
    } catch (e) {
      setErrors(isApiError(e) ? (e.errors ?? { _: e.message }) : { _: 'Нет связи с сервером' });
      setBusy(false);
    }
  }

  async function saveAndExit() {
    if (local) await q.save(local).catch(() => undefined);
    router.push('/premium');
  }

  if (!q.ready) return <div className={s.quiz} />;

  return (
    <div className={s.quiz}>
      <div className={s.quizWrap}>
        <PremiumLogo small />
        <div className={s.progressHead}>
          <span>АНКЕТА ПРОФИЛЯ</span>
          <span>
            {step} из {STEPS}
          </span>
        </div>
        <div className={s.bar} role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step} aria-label="Прогресс анкеты">
          <span style={{ width: `${(step / STEPS) * 100}%` }} />
        </div>
        <div className={s.stepRow}>
          <span>ШАГ 0{step}</span>
          <button type="button" onClick={saveAndExit}>
            СОХРАНИТЬ И ВЫЙТИ
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
            <button type="button" className={s.back} onClick={() => router.push(`/premium/quiz/${step - 1}`)}>
              ← Назад
            </button>
          ) : (
            <Link href="/premium" className={s.back}>
              ← Назад
            </Link>
          )}
          <div className={s.navRight}>
            {(step === 3 || step === 6) && (
              <button type="button" className={s.skip} onClick={() => next(true)}>
                Пропустить
              </button>
            )}
            <button type="button" className={s.next} onClick={() => next()} disabled={busy}>
              {step === 6 ? 'Продолжить →' : 'Далее →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} className={`${s.option} ${on ? s.optionOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

type StepProps = { d: PremiumAnswers; set: (p: PremiumAnswers) => void; errors?: Record<string, string> };
const num = (v: string) => Number(v.replace(/\D/g, '')) || null;

function Step1({ d, set, errors = {} }: StepProps) {
  return (
    <>
      <div className={s.section} style={{ paddingTop: 36 }}>
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
      <div className={`${s.sectionTight} ${s.grid2}`}>
        <label className={s.field}>
          <span className={s.label}>Имя</span>
          <input className={s.input} value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoComplete="given-name" maxLength={60} />
          {errors.name && <p className={s.error}>{errors.name}</p>}
        </label>
        <label className={s.field}>
          <span className={s.label}>Возраст</span>
          <input className={s.input} inputMode="numeric" value={d.age ?? ''} onChange={(e) => set({ age: num(e.target.value) })} />
          {errors.age && <p className={s.error}>{errors.age}</p>}
        </label>
      </div>
    </>
  );
}

function Step2({ d, set, errors = {} }: StepProps) {
  const [chart, setChart] = useState(false);
  const body = bodyTypeOf(d.sizeTop, d.sizeBottom);
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
            <select className={s.select} value={d[key] ?? ''} onChange={(e) => set({ [key]: e.target.value || null } as PremiumAnswers)}>
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
        <button type="button" className={s.dashed} onClick={() => setChart((v) => !v)} aria-expanded={chart}>
          Не знаю свой размер
        </button>
      </div>
      {chart && (
        <div className={s.sectionTight}>
          <div className={s.hint}>
            Ориентир по обхвату груди: XS — 86, S — 88, M — 92, L — 96, XL — 100, XXL — 104, XXXL — 108 см. Если между размерами — берите больший.
          </div>
        </div>
      )}
      {body && (
        <div className={s.sectionTight}>
          <div className={s.hint}>
            Предварительный тип фигуры: <b>{body}</b>
          </div>
        </div>
      )}
    </>
  );
}

function Step3({ d, set }: StepProps) {
  const ct = colorTypeOf(d.skinTone, d.hair);
  const row = (label: string, key: 'skinTone' | 'hair' | 'eyes', opts: [string, string][]) => (
    <div className={s.question} role="group" aria-label={label}>
      <p className={s.eyebrow} style={{ margin: 0 }}>
        {label}
      </p>
      <div className={s.options}>
        {opts.map(([v, l]) => (
          <Option key={v} on={d[key] === v} onClick={() => set({ [key]: v } as PremiumAnswers)}>
            {l}
          </Option>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className={s.section}>
        {row('Подтон кожи', 'skinTone', [['warm', 'Тёплый'], ['cold', 'Холодный']])}
        {row('Естественный цвет волос', 'hair', [['light', 'Светлые'], ['dark', 'Тёмные']])}
        {row('Цвет глаз', 'eyes', [['light', 'Светлые'], ['dark', 'Тёмные']])}
      </div>
      {ct && (
        <div className={s.sectionTight}>
          <div className={`${s.hint} ${s.hintSolid}`}>
            Ваш цветотип: <b>{COLOR_TYPES[ct].label}</b> · используем его для подбора подходящих цветов одежды.
          </div>
        </div>
      )}
    </>
  );
}

/** «Где вы работаете?» — карточки групп специальностей; подпись — специальности группы. */
function Step4({ d, set, errors = {}, groups }: StepProps & { groups: Groups }) {
  const selected = d.specialtyGroupIds ?? [];
  const toggle = (id: string) => set({ specialtyGroupIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  return (
    <div className={s.section}>
      <div className={s.cards}>
        {groups.map((g) => {
          const on = selected.includes(g.id);
          return (
            <button key={g.id} type="button" aria-pressed={on} className={`${s.card} ${on ? s.cardOn : ''}`} onClick={() => toggle(g.id)}>
              <b>{g.name}</b>
              <span>{g.specialties.map((sp) => sp.name).join(', ') || '—'}</span>
            </button>
          );
        })}
      </div>
      {errors.specialtyGroupIds && <p className={s.error}>{errors.specialtyGroupIds}</p>}
    </div>
  );
}

function Step5({ d, set, errors = {} }: StepProps) {
  return (
    <div className={s.section}>
      <div className={s.budget} role="radiogroup" aria-label="Бюджет на капсулу">
        {PREMIUM_BUDGETS.map((b) => (
          <button key={b.id} type="button" role="radio" aria-checked={d.budgetRange === b.id} className={`${s.card} ${d.budgetRange === b.id ? s.cardOn : ''}`} onClick={() => set({ budgetRange: b.id })}>
            {b.label}
          </button>
        ))}
      </div>
      {errors.budgetRange && <p className={s.error}>{errors.budgetRange}</p>}
    </div>
  );
}

/** Фото — только после входа и с отдельным согласием, как в обычной анкете; хранятся в профиле. */
function Step6({ q }: { q: ReturnType<typeof usePremiumQuiz> }) {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.authed) api<Record<string, boolean>>('/me/consents').then((c) => setConsent(c.photos)).catch(() => setConsent(false));
  }, [q.authed]);

  const canUpload = Boolean(q.authed && consent);
  const max = Math.min(PHOTO_SLOTS, MAX_PROFILE_PHOTOS);
  return (
    <>
      <div className={s.section}>
        <div className={s.photos}>
          {q.photos.slice(0, max).map((p) => (
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
          {q.photos.length < max && (
            <button type="button" className={s.addPhoto} disabled={!canUpload || busy} onClick={() => input.current?.click()}>
              <i aria-hidden>+</i>
              {busy ? 'Загружаем…' : 'Добавить фото'}
            </button>
          )}
        </div>
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
      <p className={s.note}>
        {q.photos.length}/{max} фото · можно продолжить и с одной фотографией.
      </p>
      {!q.authed ? (
        <div className={s.hint}>
          Фото хранятся в профиле — <Link href="/login?next=/premium/quiz/6">войдите</Link>, чтобы добавить их, или нажмите «Пропустить».
        </div>
      ) : consent === false ? (
        <label className={s.consent}>
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
            . Фото видны только мне; удалить их можно в профиле.
          </span>
        </label>
      ) : null}
      {error && <p className={s.error}>{error}</p>}
    </>
  );
}

/** Шаг 7 — «Всё выглядит верно?» (кадр .Premium-Quiz-7): сводка ответов и «Создать мой профиль». */
export function PremiumReview({ groups }: { groups: Groups }) {
  const router = useRouter();
  const q = usePremiumQuiz();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.ready) return <div className={s.quiz} />;
  const a = q.answers;
  const ct = colorTypeOf(a.skinTone, a.hair);
  const years = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет');
  const work = groups.filter((g) => a.specialtyGroupIds?.includes(g.id)).map((g) => g.name);
  const cards: { title: string; value: string; step?: number }[] = [
    { title: 'Имя', value: [a.name, a.gender === 'female' ? 'Женский' : a.gender === 'male' ? 'Мужской' : null, a.age ? `${a.age} ${years(a.age)}` : null].filter(Boolean).join(' · '), step: 1 },
    { title: 'Параметры', value: [a.heightCm && `${a.heightCm} см`, a.weightKg && `${a.weightKg} кг`].filter(Boolean).join(' · '), step: 2 },
    { title: 'Размер', value: [a.sizeTop && `Верх: ${a.sizeTop}`, a.sizeBottom && `Низ: ${a.sizeBottom}`, a.sizeShoes && `Обувь: ${a.sizeShoes}`].filter(Boolean).join(' · '), step: 2 },
    { title: 'Тип фигуры', value: bodyTypeOf(a.sizeTop, a.sizeBottom) ?? '' },
    { title: 'Цветотип', value: ct ? COLOR_TYPES[ct].label : '', step: 3 },
    { title: 'Профессия', value: work.join(', '), step: 4 },
    { title: 'Бюджет', value: PREMIUM_BUDGETS.find((b) => b.id === a.budgetRange)?.label ?? '', step: 5 },
    { title: 'Фотографии', value: q.authed ? `${q.photos.length} фото` : 'Без фото', step: 6 },
  ];

  async function finish() {
    setError(null);
    if (!premiumCompleteSchema.safeParse(a).success) {
      setError('Заполните пол, рост и размер верха, место работы и бюджет — без них капсулу не собрать.');
      return;
    }
    setBusy(true);
    try {
      await q.save({}, true);
      router.push('/premium/quiz/done');
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
      setBusy(false);
    }
  }

  return (
    <div className={s.quiz} style={{ paddingTop: 48 }}>
      <div className={s.reviewWrap}>
        <span className={s.eyebrow}>ВАШИ ДАННЫЕ</span>
        <h1 className={s.title} style={{ marginTop: 16 }}>
          Всё выглядит верно?
        </h1>
        <p className={s.lead} style={{ marginTop: 16 }}>
          Проверьте профиль - любой блок можно изменить отдельно.
        </p>
        <div className={s.summary}>
          {cards.map((c) => (
            <div key={c.title} className={s.summaryCard}>
              <div className={s.summaryHead}>
                <b>{c.title}</b>
                {c.step && <Link href={`/premium/quiz/${c.step}`}>Изменить</Link>}
              </div>
              <p>{c.value || '—'}</p>
            </div>
          ))}
        </div>
        {error && <p className={s.error}>{error}</p>}
        <div className={s.reviewNav}>
          <button type="button" className={s.next} onClick={finish} disabled={busy}>
            Создать мой профиль →
          </button>
        </div>
      </div>
    </div>
  );
}
