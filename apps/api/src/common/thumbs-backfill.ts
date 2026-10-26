import type { PrismaClient } from '@prisma/client';
import type { ThumbsService } from './thumbs.service';

/**
 * Досоздаёт копии 320/640/1200 для всех фото товаров и обложек журнала (scripts/thumbs-backfill.ts, демо).
 * Идемпотентно: готовые копии пропускаются; файлы, которых нет в хранилище, — тоже (считаются в missing).
 */
export async function backfillThumbs(prisma: PrismaClient, thumbs: ThumbsService, log: (s: string) => void = () => {}) {
  const res = { sources: 0, made: 0, missing: 0 };
  const run = async (key: string, fn: (k: string) => Promise<number>) => {
    res.sources++;
    try {
      res.made += await fn(key);
    } catch (e) {
      res.missing++;
      log(`${key}: ${(e as Error).message}`);
    }
  };
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.productMedia.findMany({
      where: { type: 'photo' },
      select: { id: true, storageKey: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) break;
    for (const m of page) if (m.storageKey.endsWith('.webp')) await run(m.storageKey, (k) => thumbs.ensurePhoto(k));
    cursor = page.at(-1)!.id;
  }
  const covers = [
    ...(await prisma.article.findMany({ where: { coverKey: { not: null } }, select: { coverKey: true } })),
    ...(await prisma.collection.findMany({ where: { coverKey: { not: null } }, select: { coverKey: true } })),
  ];
  for (const c of new Set(covers.map((x) => x.coverKey!))) if (c.endsWith('.webp')) await run(c, (k) => thumbs.ensureCover(k));
  return res;
}
