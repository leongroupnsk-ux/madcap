'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button, ButtonLink, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { addCapsule } from '@/lib/cart';
import c from './capsule.module.css';

type Item = {
  slot: string; slotLabel: string; pinned: boolean; alternatives: number; unavailable: boolean;
  product: { id: string; slug: string; title: string; brand: string; image: string | null } | null;
  variant: { id: string; size: string; heightRange: string | null; color: string; colorHex: string; price: number; oldPrice: number | null; stock: number } | null;
};
export type CapsuleData = { variantNo: number; variants: number[]; items: Item[]; count: number; total: number; explanations: string[] };
type Alt = { productId: string; variantId: string; title: string; brand: string; slug: string; image: string | null; color: string; colorHex: string; size: string; price: number };

export function CapsuleView({ initial }: { initial: CapsuleData }) {
  const [cap, setCap] = useState(initial);
  const [replace, setReplace] = useState<{ slot: string; label: string; alts: Alt[] } | null>(null);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (variant: number) => {
    setCap(await api<CapsuleData>(`/me/capsule?variant=${variant}`));
    setAdded(false);
  };

  return (
    <section className="container" style={{ paddingTop: 36 }}>
      <div className="eyebrow">Персональная капсула</div>
      <h1 className={c.title}>Ваши вещи работают вместе.</h1>
      {cap.variants.length > 1 && (
        <div className={c.variants}>
          <span className={c.muted}>Вариант:</span>
          {cap.variants.map((v) => (
            <button key={v} type="button" className={v === cap.variantNo ? c.vOn : c.v} onClick={() => load(v)} aria-pressed={v === cap.variantNo}>
              {v}
            </button>
          ))}
          <span className={c.muted}>— пересборка с другой основной цветовой группой</span>
        </div>
      )}
      {error && <p style={{ color: 'var(--c-error)' }}>{error}</p>}
      <div className={c.layout}>
        <div className={c.grid}>
          {cap.items.map((it) => (
            <article key={it.slot} className={c.card}>
              <div className={c.slot}>{it.slotLabel}</div>
              {it.product && it.variant ? (
                <>
                  <Link href={`/product/${it.product.slug}`} className={c.media}>
                    {it.product.image && <img src={it.product.image} alt={it.product.title} />}
                    {it.unavailable && <span className={c.out}>Нет в наличии</span>}
                  </Link>
                  <div className={c.body}>
                    <span className={c.brand}>{it.product.brand}</span>
                    <Link href={`/product/${it.product.slug}`} className={c.name}>
                      {it.product.title}
                    </Link>
                    <span className={c.muted}>
                      <i className={c.swatch} style={{ background: it.variant.colorHex }} aria-hidden />
                      {it.variant.color} · {it.variant.size}
                      {it.variant.heightRange && ` · ${it.variant.heightRange}`}
                    </span>
                    <b>{formatRub(it.variant.price)}</b>
                  </div>
                </>
              ) : (
                <div className={c.empty}>Нет подходящей вещи в вашем размере. <Link href="/quiz/2">Изменить предпочтения</Link></div>
              )}
              {it.alternatives > 0 && (
                <button
                  type="button"
                  className={c.replace}
                  onClick={async () => setReplace({ slot: it.slot, label: it.slotLabel.toLowerCase(), alts: await api<Alt[]>(`/me/capsule/${cap.variantNo}/${it.slot}/alternatives`) })}
                >
                  ↻ Заменить
                </button>
              )}
            </article>
          ))}
        </div>
        <aside className={c.panel}>
          <div className={c.eyebrowLight}>Почему мы рекомендуем эту капсулу</div>
          <ul>
            {cap.explanations.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <div className={c.total}>
            <span>{cap.count} {plural(cap.count, 'вещь', 'вещи', 'вещей')}</span>
            <b>{formatRub(cap.total)}</b>
          </div>
          <Button
            variant="accent"
            block
            disabled={!cap.count}
            onClick={() => {
              addCapsule(cap.items.filter((i) => i.variant && !i.unavailable).map((i) => ({ variantId: i.variant!.id, price: i.variant!.price })));
              setAdded(true);
            }}
          >
            Добавить капсулу
          </Button>
          {added && (
            <Link href="/cart" className={c.added}>
              ✓ В корзине · перейти →
            </Link>
          )}
          <Link href="/quiz/1" className={c.prefs}>
            Изменить предпочтения →
          </Link>
        </aside>
      </div>

      {replace && (
        <Modal eyebrow="Альтернативы" title={`Заменить ${replace.label}`} onClose={() => setReplace(null)}>
          <p className={c.muted}>Подобрали варианты в вашем размере, стиле и бюджете.</p>
          <div className={c.alts}>
            {replace.alts.map((a) => (
              <div key={a.variantId} className={c.alt}>
                {a.image && <img src={a.image} alt="" />}
                <div className={c.body}>
                  <span className={c.brand}>{a.brand}</span>
                  <span className={c.name}>{a.title}</span>
                  <span className={c.muted}>
                    <i className={c.swatch} style={{ background: a.colorHex }} aria-hidden />
                    {a.color} · {a.size}
                  </span>
                  <b>{formatRub(a.price)}</b>
                </div>
                <Button
                  block
                  onClick={async () => {
                    try {
                      setCap(await api<CapsuleData>(`/me/capsule/${cap.variantNo}/${replace.slot}`, { variantId: a.variantId }, 'PUT'));
                      setReplace(null);
                      setAdded(false);
                    } catch (e) {
                      setError(isApiError(e) ? e.message : 'Ошибка');
                      setReplace(null);
                    }
                  }}
                >
                  Выбрать
                </Button>
              </div>
            ))}
            {!replace.alts.length && <p>Других вариантов в вашем размере пока нет.</p>}
          </div>
        </Modal>
      )}
      <div style={{ marginTop: 24 }}>
        <ButtonLink href="/catalog" variant="outline">
          Смотреть весь каталог
        </ButtonLink>
      </div>
    </section>
  );
}
