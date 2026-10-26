'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Alert, useEscape } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { addCapsule } from '@/lib/cart';
import c from './capsule.module.css';
import { imgSet, type ImageSet } from '@/lib/image';

type Item = {
  slot: string; slotLabel: string; pinned: boolean; alternatives: number; unavailable: boolean;
  product: { id: string; slug: string; title: string; brand: string; image: string | null; imageSet?: ImageSet | null } | null;
  variant: { id: string; size: string; heightRange: string | null; color: string; colorHex: string; price: number; oldPrice: number | null; stock: number } | null;
};
export type CapsuleData = {
  variantNo: number; variants: number[]; items: Item[]; count: number; total: number; explanations: string[];
  /** Предел бюджета из анкеты (в копейках) и вышла ли текущая сумма за него */
  budget?: number | null; overBudget?: boolean;
};
type Alt = { productId: string; variantId: string; title: string; brand: string; slug: string; image: string | null; imageSet?: ImageSet | null; color: string; colorHex: string; size: string; price: number };

/** Строки про бюджет из сборки могут устареть после замены — показываем актуальную по текущей сумме. */
const BUDGET_LINE = /^(В бюджете до|Не уложились в бюджет)/;

export function CapsuleView({ initial }: { initial: CapsuleData }) {
  const [cap, setCap] = useState(initial);
  const [replace, setReplace] = useState<{ slot: string; label: string; alts: Alt[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(isApiError(e) ? e.message : 'Не получилось — попробуйте ещё раз');

  const load = async (variant: number) => {
    setError(null);
    try {
      setCap(await api<CapsuleData>(`/me/capsule?variant=${variant}`));
      setAdded(false);
    } catch (e) {
      fail(e);
    }
  };

  const openReplace = async (it: Item) => {
    setError(null);
    setBusy(it.slot);
    try {
      const alts = await api<Alt[]>(`/me/capsule/${cap.variantNo}/${it.slot}/alternatives`);
      setReplace({ slot: it.slot, label: it.slotLabel.toLowerCase(), alts });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const choose = async (a: Alt) => {
    if (!replace) return;
    setBusy(a.variantId);
    try {
      setCap(await api<CapsuleData>(`/me/capsule/${cap.variantNo}/${replace.slot}`, { variantId: a.variantId }, 'PUT'));
      setAdded(false);
      setReplace(null);
    } catch (e) {
      fail(e);
      setReplace(null);
    } finally {
      setBusy(null);
    }
  };

  const budgetRub = cap.budget ? formatRub(cap.budget) : null;
  const explanations = budgetRub ? cap.explanations.filter((e) => !BUDGET_LINE.test(e)) : cap.explanations;

  return (
    <section className={`container ${c.page}`}>
      <div className="eyebrow">Персональная капсула</div>
      <h1 className={c.title}>Ваши вещи работают вместе.</h1>

      {cap.variants.length > 1 && (
        <div className={c.variants} role="group" aria-label="Варианты капсулы">
          <span className={c.variantsLabel}>Вариант:</span>
          {cap.variants.map((v) => (
            <button key={v} type="button" className={v === cap.variantNo ? c.vOn : c.v} onClick={() => load(v)} aria-pressed={v === cap.variantNo}>
              {v}
            </button>
          ))}
          <span className={c.variantsHint}>— пересборка с другой основной цветовой группой</span>
        </div>
      )}

      {error && (
        <div className={c.error}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className={c.layout}>
        <div className={c.grid}>
          {cap.items.map((it) => (
            <article key={it.slot} className={c.card}>
              <div className={c.slot}>{it.slotLabel}</div>
              {it.product && it.variant ? (
                <>
                  <Link href={`/product/${it.product.slug}`} className={c.media} aria-label={`Открыть ${it.product.title}`}>
                    {it.product.image && <img {...imgSet(it.product.imageSet, '(max-width: 900px) 50vw, 240px', it.product.image)} alt="" loading="lazy" />}
                    {(it.unavailable || it.pinned) && (
                      <span className={c.badges}>
                        {it.unavailable && <span className={c.out}>Нет в наличии</span>}
                        {it.pinned && <span className={c.pin}>Закреплено</span>}
                      </span>
                    )}
                  </Link>
                  <div className={c.body}>
                    <span className={c.brand}>{it.product.brand}</span>
                    <Link href={`/product/${it.product.slug}`} className={c.name}>
                      {it.product.title}
                    </Link>
                    <span className={c.meta}>
                      {it.variant.color} · {it.variant.size}
                      {it.variant.heightRange && ` · ${it.variant.heightRange}`}
                    </span>
                    <span className={c.price}>
                      {formatRub(it.variant.price)}
                      {it.variant.oldPrice && <s>{formatRub(it.variant.oldPrice)}</s>}
                    </span>
                    {it.alternatives > 0 && (
                      <button type="button" className={c.replace} onClick={() => openReplace(it)} disabled={busy === it.slot}>
                        ↻ Заменить
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className={c.empty}>
                  <p>Нет подходящей вещи в вашем размере.</p>
                  {it.alternatives > 0 ? (
                    <button type="button" className={c.replace} onClick={() => openReplace(it)} disabled={busy === it.slot}>
                      Выбрать вещь
                    </button>
                  ) : (
                    <Link href="/quiz/2" className={c.emptyLink}>
                      Изменить предпочтения →
                    </Link>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>

        <aside className={c.panel}>
          <div className={c.panelEyebrow}>Почему мы рекомендуем эту капсулу</div>
          <ul className={c.reasons}>
            {explanations.map((e) => (
              <li key={e}>{e}</li>
            ))}
            {budgetRub && <li className={cap.overBudget ? c.reasonWarn : undefined}>{cap.overBudget ? `Не уложились в бюджет до ${budgetRub} — замените вещи или измените бюджет` : `В бюджете до ${budgetRub}`}</li>}
          </ul>
          <div className={c.total}>
            <span>
              {cap.count} {plural(cap.count, 'вещь', 'вещи', 'вещей')}
            </span>
            <b>{formatRub(cap.total)}</b>
          </div>
          {cap.overBudget && <div className={c.overBudget}>Не уложились в бюджет</div>}
          <div className={c.actions}>
            <button
              type="button"
              className={c.addBtn}
              disabled={!cap.count}
              onClick={() => {
                addCapsule(cap.items.filter((i) => i.variant && !i.unavailable).map((i) => ({ variantId: i.variant!.id, price: i.variant!.price })));
                setAdded(true);
              }}
            >
              Добавить капсулу
            </button>
            {added && (
              <Link href="/cart" className={c.link}>
                ✓ В корзине · перейти →
              </Link>
            )}
            <Link href="/quiz/1" className={c.link}>
              Изменить предпочтения →
            </Link>
          </div>
        </aside>
      </div>

      {replace && <ReplaceDialog label={replace.label} alts={replace.alts} busy={busy} onChoose={choose} onClose={() => setReplace(null)} />}
    </section>
  );
}

/** Окно «Заменить» (кадр change-product): альтернативы в размере, стиле и бюджете. */
function ReplaceDialog({ label, alts, busy, onChoose, onClose }: { label: string; alts: Alt[]; busy: string | null; onChoose: (a: Alt) => void; onClose: () => void }) {
  const close = useCallback(() => onClose(), [onClose]);
  useEscape(close);
  const title = `Заменить ${label}`;
  return (
    <div className={c.overlay} onClick={close}>
      <div className={c.dialog} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={c.dialogHead}>
          <div>
            <div className="eyebrow">Альтернативы</div>
            <h2 className={c.dialogTitle}>{title}</h2>
            <p className={c.dialogText}>Подобрали варианты в вашем размере, стиле и бюджете.</p>
          </div>
          <button type="button" className={c.close} onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        {alts.length ? (
          <div className={c.alts}>
            {alts.map((a) => (
              <article key={a.variantId} className={c.alt}>
                <div className={c.altMedia}>{a.image && <img {...imgSet(a.imageSet, '(max-width: 767px) 50vw, 200px', a.image)} alt="" />}</div>
                <div className={c.altBody}>
                  <span className={c.brand}>{a.brand}</span>
                  <span className={c.altName}>{a.title}</span>
                  <span className={c.meta}>
                    {a.color} · {a.size}
                  </span>
                  <span className={c.price}>{formatRub(a.price)}</span>
                  <button type="button" className={c.choose} onClick={() => onChoose(a)} disabled={busy !== null}>
                    Выбрать
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={c.dialogText}>Других вариантов в вашем размере пока нет.</p>
        )}
      </div>
    </div>
  );
}
