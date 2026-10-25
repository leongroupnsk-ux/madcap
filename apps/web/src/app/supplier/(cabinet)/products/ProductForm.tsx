'use client';

import { HEIGHT_RANGES, MAX_PHOTO_MB, MAX_PHOTOS, MAX_VIDEO_MB, MAX_VIDEO_SECONDS, MIN_PHOTOS, SIZES } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/supplier/Badge';
import { ProductPromotions } from './ProductPromotions';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Drawer, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { Dictionaries, Media, Product, Variant } from '@/lib/types';
import f from './form.module.css';

type Props = { dict: Dictionaries; initial?: Product };
type Text = Pick<Product, 'title' | 'brandId' | 'categoryId' | 'gender' | 'fabric' | 'treatment' | 'washing' | 'description' | 'specialtyIds'>;
type Pack = { weightG: string; lengthMm: string; widthMm: string; heightMm: string };

const emptyVariant = (colorId: string): Variant => ({ sku: '', size: 'M', heightRange: '170–176', colorId, price: 0, oldPrice: null, stock: 0, weightG: null, lengthMm: null, widthMm: null, heightMm: null });
const LIVE = new Set(['published', 'hidden']);

export function ProductForm({ dict, initial }: Props) {
  const router = useRouter();
  const [product, setProduct] = useState<Product | undefined>(initial);
  const [text, setText] = useState<Text>(() => ({
    title: initial?.title ?? '', brandId: initial?.brandId ?? '', categoryId: initial?.categoryId ?? '', gender: initial?.gender ?? 'unisex',
    fabric: initial?.fabric ?? '', treatment: initial?.treatment ?? '', washing: initial?.washing ?? '', description: initial?.description ?? '',
    specialtyIds: initial?.specialtyIds ?? [],
  }));
  // У нового товара вариантов нет — они добавляются через окно «Добавить вариант» (кадр new-variant).
  const [variants, setVariants] = useState<Variant[]>(initial?.variants ?? []);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const first = initial?.variants[0];
  const [pack, setPack] = useState<Pack>({
    weightG: String(first?.weightG ?? ''), lengthMm: first?.lengthMm ? String(first.lengthMm / 10) : '',
    widthMm: first?.widthMm ? String(first.widthMm / 10) : '', heightMm: first?.heightMm ? String(first.heightMm / 10) : '',
  });
  const [media, setMedia] = useState<Media[]>(initial?.media ?? []);
  const [mainId, setMainId] = useState<string | null>(initial?.media.find((m) => m.isMain)?.id ?? null);
  const [brands, setBrands] = useState(dict.brands);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const dragId = useRef<string | null>(null);

  // Подкатегории — сразу под родительской.
  const categoryOptions = useMemo(
    () => dict.categories.filter((c) => !c.parentId).flatMap((p) => [p, ...dict.categories.filter((c) => c.parentId === p.id)]),
    [dict],
  );
  const specName = useMemo(() => new Map(dict.specialtyGroups.flatMap((g) => g.specialties.map((sp) => [sp.id, sp.name] as const))), [dict]);
  const status = product?.moderationStatus;
  const live = status ? LIVE.has(status) : false;
  const photos = media.filter((m) => m.type === 'photo');
  const videos = media.filter((m) => m.type === 'video');

  const payload = () => ({
    ...text,
    variants: variants.map((v) => ({
      ...v,
      weightG: Number(pack.weightG) || 0,
      lengthMm: Math.round(Number(pack.lengthMm) * 10) || 0,
      widthMm: Math.round(Number(pack.widthMm) * 10) || 0,
      heightMm: Math.round(Number(pack.heightMm) * 10) || 0,
      oldPrice: v.oldPrice || null,
      heightRange: v.heightRange || null,
    })),
    media: { order: media.map((m) => m.id), mainId },
  });

  const apply = (p: Product) => {
    setProduct(p);
    setMedia(p.media);
    setMainId(p.media.find((m) => m.isMain)?.id ?? null);
    setVariants(p.variants.length ? p.variants : variants);
  };

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      if (isApiError(e)) {
        setErrors(e.errors ?? {});
        setMessage({ tone: 'error', text: e.errors ? 'Проверьте отмеченные поля' : e.message });
      } else setMessage({ tone: 'error', text: 'Нет связи с сервером' });
    } finally {
      setBusy(null);
    }
  }

  const save = (thenSubmit = false) =>
    run(thenSubmit ? 'submit' : 'save', async () => {
      setErrors({});
      let p: Product;
      if (!product) {
        p = await api<Product>('/supplier/products', payload());
        if (thenSubmit) p = await api<Product>(`/supplier/products/${p.id}/submit`, {});
        router.replace(`/supplier/products/${p.id}?created=1`);
        return;
      }
      p = await api<Product>(`/supplier/products/${product.id}`, payload(), 'PUT');
      if (thenSubmit) p = await api<Product>(`/supplier/products/${p.id}/submit`, {});
      apply(p);
      setMessage({
        tone: 'success',
        text: thenSubmit ? 'Отправлено на модерацию — обычно до 24 часов' : p.revision?.status === 'pending' ? 'Сохранено. Цены и остатки уже обновлены, правки текста и медиа — на модерации.' : 'Сохранено',
      });
    });

  const upload = (file: File) =>
    run('upload', async () => {
      if (!product) return;
      const isVideo = file.type === 'video/mp4';
      if (file.size > (isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB) * 1048576) throw { status: 400, message: `Файл больше ${isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB} МБ` };
      const form = new FormData();
      form.append('file', file);
      const p = await api<Product>(`/supplier/products/${product.id}/media`, form);
      // Новые медиа добавляем в конец текущего (несохранённого) порядка.
      const known = new Set(media.map((m) => m.id));
      const added = p.media.filter((m) => !known.has(m.id));
      setMedia([...media, ...added]);
      if (!mainId && added[0]?.type === 'photo') setMainId(added[0].id);
    });

  const move = (targetId: string) => {
    const from = dragId.current;
    if (!from || from === targetId) return;
    const list = [...media];
    const a = list.findIndex((m) => m.id === from);
    const b = list.findIndex((m) => m.id === targetId);
    const [item] = list.splice(a, 1);
    list.splice(b, 0, item);
    setMedia(list);
  };

  const variantErrors = Object.entries(errors).filter(([k]) => k.startsWith('variants'));
  const colorName = (id: string) => dict.colors.find((c) => c.id === id)?.name ?? '—';
  const packText = pack.weightG && pack.lengthMm && pack.widthMm && pack.heightMm ? `${pack.weightG} г · ${pack.lengthMm}×${pack.widthMm}×${pack.heightMm} см` : null;
  const draftLike = !status || status === 'draft' || status === 'rejected';

  return (
    <>
      <Link href="/supplier/products" className={f.back}>
        ← К товарам
      </Link>
      <div className={f.eyebrowRow}>
        <div className="eyebrow">Каталог поставщика</div>
        {status && <Badge status={status} />}
        {product?.revision?.status === 'pending' && <Badge status="revision" />}
      </div>
      <div className={s.head} style={{ alignItems: 'center' }}>
        {/* ТЗ §12 п.9: у существующего товара — «Редактирование товара» */}
        <h1>{product ? 'Редактирование товара' : 'Добавить товар'}</h1>
        <div className={s.actions}>
          <Button variant="outline" className={f.btnOutline} onClick={() => router.push('/supplier/products')}>
            Отмена
          </Button>
          {status === 'published' && (
            <Button variant="outline" className={f.btnOutline} disabled={!!busy} onClick={() => run('hide', async () => apply(await api<Product>(`/supplier/products/${product!.id}/hide`, {})))}>
              Снять с витрины
            </Button>
          )}
          {status === 'hidden' && (
            <Button variant="outline" className={f.btnOutline} disabled={!!busy} onClick={() => run('unhide', async () => apply(await api<Product>(`/supplier/products/${product!.id}/unhide`, {})))}>
              Вернуть на витрину
            </Button>
          )}
          {draftLike && (
            <Button variant="outline" className={f.btnOutline} disabled={!!busy} onClick={() => save(false)}>
              {busy === 'save' ? 'Сохраняем…' : 'Сохранить черновик'}
            </Button>
          )}
          {draftLike ? (
            <Button className={f.btnSolid} disabled={!!busy} onClick={() => save(true)}>
              {busy === 'submit' ? 'Отправляем…' : 'Отправить на модерацию'}
            </Button>
          ) : (
            <Button className={f.btnSolid} disabled={!!busy} onClick={() => save(false)}>
              {busy === 'save' ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          )}
        </div>
      </div>

      <div className={f.stack}>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {status === 'rejected' && product?.rejectReason && <Alert tone="error">Модерация отклонила товар: {product.rejectReason}. Исправьте и отправьте снова.</Alert>}
        {status === 'pending' && <div className={f.note}>Товар на модерации — обычно до 24 часов. Правки можно вносить, они попадут к модератору.</div>}
        {live && <div className={f.note}>⚠&nbsp; Правки названия, фото, видео и описания уйдут на модерацию; цены и остатки обновляются сразу.</div>}
        {product?.revision?.status === 'rejected' && <Alert tone="error">Последние правки отклонены: {product.revision.rejectReason}. На витрине прежняя версия.</Alert>}

        <section className={f.card}>
          <div className={f.grid3}>
            <label className={f.field}>
              <span className={f.label}>Название товара</span>
              <input className={f.input} value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} placeholder="Хирург" />
              {errors.title && <em>{errors.title}</em>}
            </label>
            <label className={f.field}>
              <span className={f.label}>Бренд</span>
              <span className={f.withAdd}>
                <select className={`${f.input} ${text.brandId ? '' : f.placeholder}`} value={text.brandId} onChange={(e) => setText({ ...text, brandId: e.target.value })}>
                  <option value="">Выберите из списка</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={f.addBtn}
                  title="Добавить бренд"
                  aria-label="Добавить бренд"
                  onClick={() =>
                    run('brand', async () => {
                      const name = prompt('Название нового бренда')?.trim();
                      if (!name) return;
                      const b = await api<{ id: string; name: string; slug: string }>('/supplier/brands', { name });
                      setBrands([...brands, b].sort((x, y) => x.name.localeCompare(y.name)));
                      setText((t) => ({ ...t, brandId: b.id }));
                    })
                  }
                >
                  +
                </button>
              </span>
              {errors.brandId && <em>{errors.brandId}</em>}
            </label>
            <label className={f.field}>
              <span className={f.label}>Категория</span>
              <select className={`${f.input} ${text.categoryId ? '' : f.placeholder}`} value={text.categoryId} onChange={(e) => setText({ ...text, categoryId: e.target.value })}>
                <option value="">Выберите из списка</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? `— ${c.name}` : c.name}
                  </option>
                ))}
              </select>
              {errors.categoryId && <em>{errors.categoryId}</em>}
            </label>
            <label className={f.field}>
              <span className={f.label}>Пол</span>
              <select className={f.input} value={text.gender} onChange={(e) => setText({ ...text, gender: e.target.value as Text['gender'] })}>
                <option value="unisex">Унисекс</option>
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
              </select>
            </label>
            <label className={f.field}>
              <span className={f.label}>Состав ткани</span>
              <input className={f.input} value={text.fabric} onChange={(e) => setText({ ...text, fabric: e.target.value })} placeholder="65% ПЭ · 35% хлопок" />
            </label>
            <label className={f.field}>
              <span className={f.label}>Обработка</span>
              <input className={f.input} value={text.treatment} onChange={(e) => setText({ ...text, treatment: e.target.value })} placeholder="Антибактериальная" />
            </label>
            <label className={f.field}>
              <span className={f.label}>Стирка</span>
              <input className={f.input} value={text.washing} onChange={(e) => setText({ ...text, washing: e.target.value })} placeholder="до 60° · 600+ циклов" />
            </label>
            <div className={`${f.field} ${f.span2}`}>
              <span className={f.label}>Специальности</span>
              <div className={f.chips}>
                {text.specialtyIds.map((id) => (
                  <button key={id} type="button" className={f.chip} onClick={() => setText({ ...text, specialtyIds: text.specialtyIds.filter((x) => x !== id) })} title="Убрать">
                    {specName.get(id)} <span aria-hidden>×</span>
                  </button>
                ))}
                <button type="button" className={f.addChip} onClick={() => setSpecOpen(true)}>
                  + добавить
                </button>
              </div>
            </div>
          </div>
          <label className={`${f.field} ${f.descr}`}>
            <span className={f.label}>Описание</span>
            <textarea className={f.textarea} rows={3} value={text.description} onChange={(e) => setText({ ...text, description: e.target.value })} placeholder="Добавьте краткое описание товара." />
            {errors.description && <em>{errors.description}</em>}
          </label>
        </section>

        <div className={f.cols}>
          <section className={f.box}>
            <div className={f.boxHead}>
              <span className={f.boxTitle}>
                Фото<span> · {photos.length}</span>
              </span>
              <span className={f.boxHint}>
                мин. {MIN_PHOTOS}, нейтральный фон, до {MAX_PHOTO_MB} МБ
              </span>
            </div>
            <MediaGrid
              live={live}
              items={photos}
              mainId={mainId}
              disabled={!product}
              onMain={setMainId}
              onRemove={(id) => {
                setMedia(media.filter((m) => m.id !== id));
                if (mainId === id) setMainId(photos.find((p) => p.id !== id)?.id ?? null);
              }}
              onDragStart={(id) => (dragId.current = id)}
              onDrop={move}
              addLabel="+ Фото"
              accept="image/jpeg,image/png,image/webp,image/heic"
              canAdd={photos.length < MAX_PHOTOS}
              onFile={upload}
              busy={busy === 'upload'}
              colors={[...new Set(variants.map((v) => v.colorId))].map((id) => dict.colors.find((c) => c.id === id)).filter((c): c is (typeof dict.colors)[number] => !!c)}
              onColor={async (mediaId, colorId) => {
                if (!product) return;
                try {
                  const p = await api<Product>(`/supplier/products/${product.id}/media/${mediaId}/color`, { colorId }, 'PUT');
                  setMedia(media.map((m) => ({ ...m, colorId: p.media.find((x) => x.id === m.id)?.colorId ?? m.colorId })));
                } catch (e) {
                  setMessage({ tone: 'error', text: isApiError(e) ? e.message : 'Не удалось сохранить цвет фото' });
                }
              }}
            />
            {!product && <p className={f.boxHint}>Фото можно добавить после сохранения черновика.</p>}
            {variants.some((v) => v.colorId !== variants[0]?.colorId) && (
              <p className={f.boxHint}>
                Укажите цвет у фото — покупатель увидит снимки выбранного цвета. Фото «для всех цветов» показываются, если своих нет. Сохранённые цвета вариантов — после «Сохранить».
              </p>
            )}
          </section>
          <section className={f.box}>
            <div className={f.boxHead}>
              <span className={f.boxTitle}>
                Видео<span> · {videos.length}</span>
              </span>
              <span className={f.boxHint}>
                mp4, до {MAX_VIDEO_MB} МБ, до {MAX_VIDEO_SECONDS} секунд
              </span>
            </div>
            <MediaGrid
              live={live}
              items={videos}
              mainId={null}
              disabled={!product}
              onRemove={(id) => setMedia(media.filter((m) => m.id !== id))}
              onDragStart={(id) => (dragId.current = id)}
              onDrop={move}
              addLabel="+ Видео"
              accept="video/mp4"
              canAdd={videos.length < 2}
              onFile={upload}
              busy={busy === 'upload'}
            />
          </section>
        </div>

        <div className={f.cols}>
          <section className={f.box} style={{ gap: 16 }}>
            <div className={f.boxHead} style={{ alignItems: 'center' }}>
              <span className={f.boxTitle}>
                Варианты<span> · {variants.length}</span>
              </span>
              <button type="button" className={f.linkBtn} onClick={() => setEditing('new')}>
                + Добавить вариант
              </button>
            </div>
            <div className={f.vscroll}>
              <table className={f.vtable}>
                <colgroup>
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '22%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Размер-рост</th>
                    <th>Цвет</th>
                    <th>Цена, ₽</th>
                    <th>Старая, ₽</th>
                    <th>Ост., шт</th>
                    <th>SKU</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => (
                    <tr key={v.id ?? `new-${i}`}>
                      <td>
                        <button type="button" className={f.vEdit} onClick={() => setEditing(i)}>
                          {v.size}
                          {v.heightRange ? ` · ${v.heightRange}` : ''}
                        </button>
                      </td>
                      <td title={colorName(v.colorId)}>{colorName(v.colorId)}</td>
                      <td className={f.vPrice}>{v.price ? v.price.toLocaleString('ru-RU') : '—'}</td>
                      <td className={v.oldPrice ? f.vOld : undefined}>{v.oldPrice ? v.oldPrice.toLocaleString('ru-RU') : '—'}</td>
                      <td className={v.stock <= 2 ? f.vLow : f.vOk}>{v.stock}</td>
                      <td title={v.sku}>{v.sku || '—'}</td>
                    </tr>
                  ))}
                  {!variants.length && (
                    <tr>
                      <td colSpan={6} className={f.vEmpty} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className={f.pack}>{packText ? `Вес и габариты для СДЭК: ${packText}` : 'Вес и габариты для СДЭК — укажите при создании варианта.'}</div>
            {variantErrors.length > 0 && (
              <ul className={f.errors}>
                {variantErrors.map(([k, msg]) => (
                  <li key={k}>{describeVariantError(k, msg)}</li>
                ))}
              </ul>
            )}
          </section>

          <div className={f.colStack}>
            {product && (status === 'published' || status === 'pending') && <ProductPromotions productId={product.id} />}
            <section className={`${f.box} ${f.boxSm}`}>
              <span className={f.boxTitle}>Источник данных</span>
              <div className={f.source}>
                <span className={f.sourceIcon}>
                  <img src="/design/icons/sup-source.svg" alt="" width={16} height={16} />
                </span>
                <p>
                  {!product
                    ? 'Товар создаётся вручную — источник зафиксируется при сохранении.'
                    : product.source === 'manual'
                      ? `Создан вручную ${new Date(product.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' })} (МСК)`
                      : `Создан из ${product.source === 'yml' ? 'YML-фида' : 'файла импорта'} (артикул модели ${product.externalId}) · остатки и цены обновляются при каждом импорте`}
                  {product?.manualOverride && ' · медиа и описание отредактированы вручную и защищены от перезаписи (manual_override)'}
                </p>
              </div>
            </section>
            {product && draftLike && status !== undefined && (
              <div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    confirm('Удалить черновик без возможности восстановления?') &&
                    run('delete', async () => {
                      await api(`/supplier/products/${product.id}`, undefined, 'DELETE');
                      router.replace('/supplier/products');
                    })
                  }
                >
                  Удалить черновик
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing !== null && (
        <VariantModal
          productTitle={text.title}
          initial={editing === 'new' ? { ...emptyVariant(variants.at(-1)?.colorId ?? dict.colors[0]?.id ?? ''), price: variants.at(-1)?.price ?? 0, oldPrice: variants.at(-1)?.oldPrice ?? null } : variants[editing]}
          isNew={editing === 'new'}
          colors={dict.colors}
          pack={pack}
          onClose={() => setEditing(null)}
          onDelete={() => {
            if (typeof editing === 'number') setVariants(variants.filter((_, j) => j !== editing));
            setEditing(null);
          }}
          onSave={(v, p) => {
            setVariants(editing === 'new' ? [...variants, v] : variants.map((x, j) => (j === editing ? v : x)));
            setPack(p);
            setEditing(null);
          }}
        />
      )}

      {specOpen && (
        <Drawer eyebrow="Товар" title="Специальности" onClose={() => setSpecOpen(false)}>
          <p className={s.muted}>Для каких специальностей подходит товар — от этого зависит попадание в капсулы.</p>
          {dict.specialtyGroups.map((g) => (
            <fieldset key={g.id} className={f.specGroup}>
              <legend>{g.name}</legend>
              {g.specialties.map((sp) => (
                <label key={sp.id} className={f.specItem}>
                  <input
                    type="checkbox"
                    checked={text.specialtyIds.includes(sp.id)}
                    onChange={(e) => setText((t) => ({ ...t, specialtyIds: e.target.checked ? [...t.specialtyIds, sp.id] : t.specialtyIds.filter((x) => x !== sp.id) }))}
                  />
                  {sp.name}
                </label>
              ))}
            </fieldset>
          ))}
          <Button block onClick={() => setSpecOpen(false)}>
            Готово
          </Button>
        </Drawer>
      )}
    </>
  );
}

function describeVariantError(key: string, msg: string) {
  const m = key.match(/^variants\.(\d+)\.(\w+)/);
  return m ? `Вариант ${Number(m[1]) + 1}: ${msg}` : msg;
}

/**
 * Окно варианта (кадр new-variant): размер и ростовка, цвет, цены, остаток, SKU, упаковка для СДЭК.
 * Упаковка общая для всех вариантов товара — как и раньше, она применяется ко всем при сохранении товара.
 * Изменения попадают в форму; на сервер — по кнопке «Сохранить» товара.
 */
function VariantModal(props: {
  productTitle: string; initial: Variant; isNew: boolean; colors: Dictionaries['colors']; pack: Pack;
  onClose: () => void; onDelete: () => void; onSave: (v: Variant, pack: Pack) => void;
}) {
  const [v, setV] = useState<Variant>(props.initial);
  const [dims, setDims] = useState(() => (props.pack.lengthMm ? [props.pack.lengthMm, props.pack.widthMm, props.pack.heightMm].join('×') : ''));
  const [weight, setWeight] = useState(props.pack.weightG);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Variant>) => setV((x) => ({ ...x, ...patch }));

  const submit = () => {
    const parts = dims.trim() ? dims.split(/\s*[x×х*]\s*/i).map((n) => n.replace(',', '.').trim()) : [];
    if (!v.size.trim()) return setErr('Укажите размер');
    if (!v.sku.trim()) return setErr('Укажите SKU');
    if (!(v.price > 0)) return setErr('Укажите цену');
    if (parts.length && (parts.length !== 3 || parts.some((n) => !(Number(n) > 0)))) return setErr('Размер посылки — три числа через «×», например 30×25×5');
    props.onSave(
      { ...v, size: v.size.trim(), sku: v.sku.trim() },
      parts.length ? { weightG: weight, lengthMm: parts[0], widthMm: parts[1], heightMm: parts[2] } : { ...props.pack, weightG: weight },
    );
  };

  return (
    <Modal eyebrow={props.productTitle || 'Новый товар'} title={props.isNew ? 'Добавить вариант' : 'Изменить вариант'} onClose={props.onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <datalist id="sizes">
          {SIZES.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <div className={`${f.grid2} ${f.modalGrid}`}>
          <div className={f.field}>
            <span className={f.label}>Размер-рост</span>
            <span className={f.pair}>
              <input className={f.input} list="sizes" value={v.size} onChange={(e) => set({ size: e.target.value })} aria-label="Размер" placeholder="M" autoFocus />
              <select className={f.input} value={v.heightRange ?? ''} onChange={(e) => set({ heightRange: e.target.value || null })} aria-label="Ростовка">
                <option value="">без роста</option>
                {HEIGHT_RANGES.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </span>
          </div>
          <label className={f.field}>
            <span className={f.label}>Цвет</span>
            <select className={f.input} value={v.colorId} onChange={(e) => set({ colorId: e.target.value })}>
              {props.colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={f.field}>
            <span className={f.label}>Цена, ₽</span>
            <input className={f.input} type="number" min={0} inputMode="numeric" value={v.price || ''} onChange={(e) => set({ price: Number(e.target.value) })} placeholder="4590" />
          </label>
          <label className={f.field}>
            <span className={f.label}>Старая цена, ₽</span>
            <input className={f.input} type="number" min={0} inputMode="numeric" value={v.oldPrice ?? ''} onChange={(e) => set({ oldPrice: e.target.value ? Number(e.target.value) : null })} placeholder="5290" />
          </label>
          <label className={f.field}>
            <span className={f.label}>Остаток, шт</span>
            <input className={f.input} type="number" min={0} inputMode="numeric" value={v.stock} onChange={(e) => set({ stock: Number(e.target.value) })} />
          </label>
          <label className={f.field}>
            <span className={f.label}>SKU</span>
            <input className={f.input} value={v.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="MT-1101-TL-M" />
          </label>
          <label className={f.field}>
            <span className={f.label}>Размер посылки, Д×Ш×В см</span>
            <input className={f.input} value={dims} onChange={(e) => setDims(e.target.value)} placeholder="30×25×5" />
          </label>
          <label className={f.field}>
            <span className={f.label}>Вес посылки, г</span>
            <input className={f.input} type="number" min={1} inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="600" />
          </label>
        </div>
        {err && <Alert tone="error">{err}</Alert>}
        <div className={f.modalActions}>
          <Button type="button" variant="outline" className={f.btnOutline} onClick={props.onClose}>
            Отмена
          </Button>
          {!props.isNew && (
            <Button type="button" variant="outline" className={f.btnOutline} onClick={props.onDelete}>
              Удалить вариант
            </Button>
          )}
          <Button type="submit" className={f.btnSolid}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MediaGrid(props: {
  live: boolean;
  items: Media[]; mainId: string | null; disabled: boolean; onMain?: (id: string) => void; onRemove: (id: string) => void;
  onDragStart: (id: string) => void; onDrop: (id: string) => void; addLabel: string; accept: string; canAdd: boolean; onFile: (f: File) => void; busy: boolean;
  colors?: { id: string; name: string; hex: string }[]; onColor?: (mediaId: string, colorId: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={f.media}>
      {props.items.map((m) => (
        <div key={m.id} className={f.mediaCell}>
          <div
            className={`${f.tileMedia} ${m.id === props.mainId ? f.main : ''}`}
            draggable
            onDragStart={() => props.onDragStart(m.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => props.onDrop(m.id)}
            onClick={() => props.onMain?.(m.id)}
            title={props.onMain ? 'Нажмите, чтобы сделать главным; перетащите, чтобы изменить порядок' : 'Перетащите, чтобы изменить порядок'}
          >
            {m.thumbUrl ? <img src={m.thumbUrl} alt="" /> : <span className={f.processing}>{m.type === 'video' ? 'Готовим постер…' : ''}</span>}
            {m.type === 'video' && <span className={f.play}>▶ {m.durationS ? `${Math.round(m.durationS)} с` : ''}</span>}
            {m.id === props.mainId && <span className={f.mainTag}>Главное</span>}
            {props.live && !m.approved && <span className={f.pendingTag}>на модерации</span>}
            <button
              type="button"
              className={f.removeMedia}
              onClick={(e) => {
                e.stopPropagation();
                props.onRemove(m.id);
              }}
              aria-label="Убрать"
            >
              <img src="/design/icons/circle-x.svg" alt="" width={36} height={36} />
            </button>
          </div>
          {props.onColor && props.colors && props.colors.length > 1 && (
            <select className={f.mediaColor} value={m.colorId ?? ''} disabled={props.disabled} onChange={(e) => props.onColor!(m.id, e.target.value || null)} aria-label="Цвет на фото">
              <option value="">Все цвета</option>
              {props.colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      {props.canAdd && (
        <button type="button" className={f.addMedia} disabled={props.disabled || props.busy} onClick={() => input.current?.click()}>
          {props.busy ? 'Загружаем…' : props.addLabel}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={props.accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) props.onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
