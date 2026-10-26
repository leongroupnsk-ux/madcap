'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PremiumLogo } from '@/components/premium/PremiumLogo';
import s from '@/components/premium/premium.module.css';
import { readChoice, usePremiumQuiz, writeChoice, type CapsuleChoice } from '@/components/premium/usePremiumQuiz';
import { useEscape } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { LeadModal } from './LeadModal';
import { imgSet, type ImageSet } from '@/lib/image';

export type Item = {
  slot: string; slotLabel: string; productId: string; variantId: string; slug: string; title: string; brand: string;
  color: string; colorHex: string; size: string; price: number; oldPrice: number | null; image: string | null; imageSet?: ImageSet | null;
};
export type PremiumCapsule = {
  variantNo: number; variants: number; title: string; note: string; size: string | null;
  items: (Item & { alternatives: Item[] })[]; count: number; total: number; budget: number | null; overBudget: boolean; explanations: string[];
};

const STEP = 189; // ширина карточки 177 + зазор 12

/** Премиум-капсула (кадр .Premium-capsule): варианты 01–03, замена вещи, итог и «Оставить заявку». */
export function CapsuleView() {
  const q = usePremiumQuiz();
  const [choice, setChoice] = useState<CapsuleChoice>({ variantNo: 1, overrides: {} });
  const [cap, setCap] = useState<PremiumCapsule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replace, setReplace] = useState<(Item & { alternatives: Item[] }) | null>(null);
  const [lead, setLead] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => setChoice(readChoice()), []);

  const load = useCallback(
    async (c: CapsuleChoice) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<PremiumCapsule>('/premium/capsule', { answers: q.answers, variantNo: c.variantNo, overrides: c.overrides[c.variantNo] ?? {} });
        setCap(res);
      } catch (e) {
        setError(isApiError(e) ? e.message : 'Нет связи с сервером');
      } finally {
        setLoading(false);
      }
    },
    [q.answers],
  );

  useEffect(() => {
    if (q.ready && q.completed) void load(choice);
    else if (q.ready) setLoading(false);
  }, [q.ready, q.completed, choice, load]);

  const update = (c: CapsuleChoice) => {
    setChoice(c);
    writeChoice(c);
  };
  const pickVariant = (n: number) => update({ ...choice, variantNo: n });
  const choose = (slot: string, variantId: string) => {
    const cur = choice.overrides[choice.variantNo] ?? {};
    update({ ...choice, overrides: { ...choice.overrides, [choice.variantNo]: { ...cur, [slot]: variantId } } });
    setReplace(null);
  };

  const syncEdges = () => {
    const el = track.current;
    if (el) setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(syncEdges, [cap]);
  const scroll = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * STEP, behavior: 'smooth' });

  const header = (
    <header className={`${s.container} ${s.capHeader}`}>
      <PremiumLogo />
      <Link href="/" className={s.monoLink}>
        НАЗАД НА САЙТ →
      </Link>
    </header>
  );
  const footer = (
    <footer className={`${s.container} ${s.capFooter}`}>
      <span>Медицинская одежда для светлого будущего</span>
      <span>- AESCULAP</span>
    </footer>
  );

  if (!q.ready || (loading && !cap)) return <div className={s.quizBg} style={{ minHeight: '100svh' }}>{header}</div>;

  if (!q.completed || error || !cap || !cap.items.length) {
    return (
      <div className={s.quizBg} style={{ minHeight: '100svh' }}>
        {header}
        <div className={s.container}>
          <div className={s.emptyState}>
            <span className={s.eyebrow}>ПЕРСОНАЛЬНАЯ КАПСУЛА</span>
            <h1 className={s.title}>{!q.completed ? 'Сначала пройдите анкету' : 'Пока не из чего собрать'}</h1>
            <p className={s.lead}>
              {!q.completed
                ? 'Семь коротких шагов — и мы соберём капсулу из премиальной коллекции под ваш размер, цвет и бюджет.'
                : (error ?? 'В премиальной коллекции сейчас нет вещей в вашем размере. Измените параметры или загляните позже.')}
            </p>
            <Link href={q.completed ? '/premium/quiz/7' : '/premium/quiz/1'} className={s.btn}>
              {q.completed ? 'изменить анкету' : 'пройти анкету'} <span className={s.arrow}>→</span>
            </Link>
          </div>
        </div>
        {footer}
      </div>
    );
  }

  const nums = Array.from({ length: cap.variants }, (_, i) => i + 1);
  const meta = `${cap.count} ${plural(cap.count, 'вещь', 'вещи', 'вещей')}${cap.size ? `     ·     Размер ${cap.size}` : ''}`;
  return (
    <div className={s.quizBg}>
      {header}
      <div className={`${s.container} ${s.capBody}`}>
        <div className={s.preview}>
          <img src="/design/premium/capsule-preview.webp" alt="Образ из премиальной капсулы" />
        </div>
        <div className={s.capContent}>
          <div className={s.capTop}>
            <div className={s.capIntro}>
              <div>
                <span className={s.eyebrow}>ПЕРСОНАЛЬНАЯ КАПСУЛА</span>
                <h1 className={s.capTitle}>
                  Ваши вещи
                  <br />
                  работают вместе.
                </h1>
              </div>
              <p className={s.capLead}>Продуманные сочетания для вашего комфорта, уверенности и профессионального образа.</p>
            </div>
            <div className={s.variants}>
              <span>
                Вариант {String(cap.variantNo).padStart(2, '0')} / {String(cap.variants).padStart(2, '0')}
              </span>
              <div className={s.variantRow}>
                <div className={s.variantNums} role="group" aria-label="Варианты капсулы">
                  {nums.map((n) => (
                    <button key={n} type="button" aria-pressed={n === cap.variantNo} className={`${s.variantNum} ${n === cap.variantNo ? s.variantOn : ''}`} onClick={() => pickVariant(n)}>
                      {String(n).padStart(2, '0')}
                    </button>
                  ))}
                </div>
                {cap.variants > 1 && (
                  <button type="button" className={s.rebuild} onClick={() => pickVariant((cap.variantNo % cap.variants) + 1)}>
                    Пересобрать
                    <br />с другой цветовой группой
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className={s.capName}>
            <h2>{cap.title}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {meta}
              {cap.note && (
                <>
                  {'     ·     '}
                  <span>{cap.note}</span>
                </>
              )}
            </p>
          </div>
          <div className={s.row} aria-busy={loading}>
            <button type="button" className={`${s.navBtn} ${s.navPrev}`} onClick={() => scroll(-1)} disabled={edges.start} aria-label="Назад">
              <img src="/design/premium/arrow-left.svg" width={20} height={20} alt="" />
            </button>
            <div className={s.track} ref={track} onScroll={syncEdges}>
              {cap.items.map((it) => (
                <ProductCard key={it.slot} item={it} onReplace={it.alternatives.length ? () => setReplace(it) : undefined} />
              ))}
            </div>
            {!edges.end && <div className={s.fade} />}
            <button type="button" className={`${s.navBtn} ${s.navNext}`} onClick={() => scroll(1)} disabled={edges.end} aria-label="Вперёд">
              <img src="/design/premium/arrow-left.svg" width={20} height={20} alt="" />
            </button>
          </div>
          <div className={s.capFoot}>
            <div className={s.total}>
              <div className={s.totalText}>
                <div>
                  <span>{meta.replace(/ {5}/g, ' ')}</span>
                  <span>Итоговая стоимость</span>
                </div>
                <b>{formatRub(cap.total)}</b>
              </div>
              <div className={s.vline} />
              <button type="button" className={s.btnSilver} onClick={() => setLead(true)}>
                оставить заявку
              </button>
            </div>
            <div className={s.benefits}>
              <span>
                <img src="/design/premium/star.svg" width={16} height={16} alt="" />
                Стильная капсула
              </span>
              <span>
                <img src="/design/premium/refresh.svg" width={16} height={16} alt="" />
                Легко комбинировать
              </span>
              <span>
                <img src="/design/premium/shield.svg" width={16} height={16} alt="" />
                Профессиональное качество
              </span>
            </div>
          </div>
          {cap.overBudget && cap.budget && <p className={s.over}>Сумма выше выбранного бюджета ({formatRub(cap.budget)}) — замените вещи или обсудите с менеджером.</p>}
        </div>
      </div>
      {footer}
      {replace && <ReplaceDialog item={replace} onClose={() => setReplace(null)} onChoose={(v) => choose(replace.slot, v)} />}
      {lead && <LeadModal cap={cap} answers={q.answers} overrides={choice.overrides[cap.variantNo] ?? {}} onClose={() => setLead(false)} />}
    </div>
  );
}

/** Карточка вещи капсулы (компонент Frame 1, 285:4098); в окне замены — без ссылки, вся карточка кнопка. */
export function ProductCard({ item, onReplace, asButton }: { item: Item; onReplace?: () => void; asButton?: boolean }) {
  const img = item.image && <img {...imgSet(item.imageSet, '(max-width: 767px) 50vw, 320px', item.image)} alt={item.title} loading="lazy" />;
  return (
    <span className={s.pcard}>
      {asButton ? (
        <span className={s.pcardImg}>{img}</span>
      ) : (
        <Link href={`/product/${item.slug}`} className={s.pcardImg} target="_blank" aria-label={`${item.title} — карточка товара`}>
          {img}
        </Link>
      )}
      <span className={s.pcardBody}>
        <span className={s.pcardSlot}>{item.slotLabel}</span>
        <span className={s.pcardTitle}>{item.title}</span>
        <span className={s.pcardMeta}>{item.slot === 'accessory' ? item.color : `${item.color} · ${item.size}`}</span>
        <span className={s.pcardPrice}>
          {formatRub(item.price)}
          {item.oldPrice && item.oldPrice > item.price && <s>{formatRub(item.oldPrice)}</s>}
        </span>
        {onReplace && (
          <button type="button" className={s.replace} onClick={onReplace}>
            ↻ Заменить
          </button>
        )}
      </span>
    </span>
  );
}

function ReplaceDialog({ item, onClose, onChoose }: { item: Item & { alternatives: Item[] }; onClose: () => void; onChoose: (variantId: string) => void }) {
  useEscape(onClose);
  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={`Заменить: ${item.slotLabel}`} onClick={(e) => e.stopPropagation()}>
        <div className={s.dialogHead}>
          <div>
            <span className={s.eyebrow}>ЗАМЕНА · {item.slotLabel.toUpperCase()}</span>
            <h2>Выберите другую вещь</h2>
          </div>
          <button type="button" className={`${s.close} ${s.closeLight}`} onClick={onClose} aria-label="Закрыть">
            <img src="/design/premium/plus.svg" width={15.5} height={15.5} alt="" />
          </button>
        </div>
        <div className={s.altGrid}>
          {item.alternatives.map((a) => (
            <button key={a.variantId} type="button" className={s.altCard} onClick={() => onChoose(a.variantId)} aria-label={`Выбрать ${a.title}, ${a.color}`}>
              <ProductCard item={a} asButton />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
