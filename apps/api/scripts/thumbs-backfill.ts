/**
 * Копии фото по ширине (320/640/1200, WebP) для загруженных до их появления фото товаров и обложек журнала.
 *   pnpm --filter @aesculap/api thumbs:backfill
 *   docker compose -f docker-compose.prod.yml exec api npx tsx scripts/thumbs-backfill.ts
 * Повторный запуск безопасен: готовые копии пропускаются. Без бэкфилла копии тоже появятся — лениво, при первом запросе.
 */
import { PrismaClient } from '@prisma/client';
import { StorageService } from '../src/common/storage.service';
import { backfillThumbs } from '../src/common/thumbs-backfill';
import { ThumbsService } from '../src/common/thumbs.service';

const prisma = new PrismaClient();
backfillThumbs(prisma, new ThumbsService(new StorageService()), (s) => console.warn(s))
  .then((r) => console.log(`Исходников: ${r.sources}, создано копий: ${r.made}, не найдено или не прочитано: ${r.missing}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
