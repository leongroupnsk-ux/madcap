type M = { storageKey: string; colorId: string | null; isMain: boolean; position: number };

/**
 * Фото для варианта (ТЗ §4.3): сначала фото его цвета, затем общие (без цвета), затем любые.
 * На входе — фото товара в любом порядке; на выходе — по главному и позиции.
 */
export function photosFor<T extends M>(media: T[], colorId: string | null | undefined): T[] {
  const sorted = [...media].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.position - b.position);
  const own = colorId ? sorted.filter((m) => m.colorId === colorId) : [];
  if (own.length) return own;
  const common = sorted.filter((m) => !m.colorId);
  return common.length ? common : sorted;
}

export const thumbKey = (m: { storageKey: string } | undefined) => (m ? m.storageKey.replace(/\.webp$/, '_thumb.webp') : null);

/** Выборка фото для витрины: только одобренные фотографии */
export const PHOTOS = { where: { approved: true, type: 'photo' as const }, orderBy: [{ isMain: 'desc' as const }, { position: 'asc' as const }] };
