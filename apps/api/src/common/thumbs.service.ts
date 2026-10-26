import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { CARD_WIDTHS, IMAGE_WIDTHS, parseVariant, thumbOf, variantKey } from './image-keys';
import { StorageService } from './storage.service';

/**
 * Копии фото по ширине для srcset (ключи и версии — image-keys.ts). Создаются при загрузке фото и обложек,
 * для загруженных раньше — лениво при первом запросе копии через /api/files или скриптом scripts/thumbs-backfill.ts.
 */
@Injectable()
export class ThumbsService {
  private readonly logger = new Logger('Thumbs');
  private readonly inflight = new Map<string, Promise<boolean>>();

  constructor(private readonly storage: StorageService) {}

  /** Копия заданной ширины: без кадрирования и без увеличения, WebP */
  static render(source: Buffer, width: number): Promise<Buffer> {
    return sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: width <= 320 ? 75 : 80 })
      .toBuffer();
  }

  /** Создаёт недостающие копии исходника; готовые не трогает (идемпотентно). Возвращает число созданных. */
  async ensure(source: string, widths: readonly number[], data?: Buffer): Promise<number> {
    let made = 0;
    let buf = data;
    for (const w of widths) {
      const key = variantKey(source, w);
      if (await this.storage.exists(key)) continue;
      buf ??= await this.storage.read(source);
      await this.storage.put(key, await ThumbsService.render(buf, w));
      made++;
    }
    return made;
  }

  /** Копии фото товара: оригинала (галерея) и превью карточки, если превью есть */
  async ensurePhoto(key: string, data?: Buffer, thumb?: Buffer): Promise<number> {
    let made = await this.ensure(key, IMAGE_WIDTHS, data);
    if (thumb || (await this.storage.exists(thumbOf(key)))) made += await this.ensure(thumbOf(key), CARD_WIDTHS, thumb);
    return made;
  }

  /** Копии обложки статьи или подборки */
  ensureCover(key: string, data?: Buffer): Promise<number> {
    return this.ensure(key, IMAGE_WIDTHS, data);
  }

  /** Ленивая догенерация по запросу: true — копия есть или только что создана; false — это не копия или нет исходника */
  async ensureVariant(key: string): Promise<boolean> {
    const v = parseVariant(key);
    if (!v) return false;
    if (await this.storage.exists(key)) return true;
    let job = this.inflight.get(key);
    if (!job) {
      job = (async () => {
        if (!(await this.storage.exists(v.source))) return false;
        await this.ensure(v.source, [v.width]);
        return true;
      })()
        .catch((e: Error) => {
          this.logger.error(`Копия ${key}: ${e.message}`);
          return false;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    return job;
  }
}
