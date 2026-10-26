import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { IMAGE_WIDTHS, type ImageSet, THUMB_WIDTH, CARD_WIDTHS, thumbOf, variantKey } from './image-keys';

/**
 * Хранилище файлов. Ключи `public/...` отдаются наружу через /api/files,
 * `private/...` (фото покупателей, файлы импорта) — никогда (ТЗ §10, §11).
 * В dev — локальный диск (STORAGE_DRIVER=local); драйвер S3 — до запуска (E6-02).
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(process.env.STORAGE_LOCAL_DIR ?? './.storage');

  private path(key: string): string {
    if (!/^(public|private)\/[\w./-]+$/.test(key) || key.includes('..')) throw new Error(`Недопустимый ключ ${key}`);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Ключ вне хранилища: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    // Через временный файл: параллельный запрос не получит недописанную копию
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, full);
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.path(key)).then(
      () => true,
      () => false,
    );
  }

  stream(key: string): Readable {
    return createReadStream(this.path(key));
  }

  localPath(key: string): string {
    return this.path(key);
  }

  async remove(key: string | null | undefined): Promise<void> {
    if (key) await rm(this.path(key), { force: true });
  }

  publicUrl(key: string | null | undefined): string | null {
    return key?.startsWith('public/') ? `/api/files/${key.slice('public/'.length)}` : null;
  }

  /**
   * Набор размеров для srcset (фото товара в галерее, обложки статей и подборок). width/height — размеры исходника,
   * если известны: копия не шире исходника, и в srcset пишется её настоящая ширина.
   */
  imageSet(key: string | null | undefined, width?: number | null, height?: number | null): ImageSet | null {
    const url = this.publicUrl(key);
    if (!url || !key) return null;
    if (!key.endsWith('.webp')) return { src: url, srcSet: '', width: width ?? null, height: height ?? null };
    const seen = new Set<number>();
    const parts: string[] = [];
    for (const w of IMAGE_WIDTHS) {
      const real = width ? Math.min(w, width) : w;
      if (seen.has(real)) continue;
      seen.add(real);
      parts.push(`${this.publicUrl(variantKey(key, w))} ${real}w`);
    }
    return { src: this.publicUrl(variantKey(key, 640))!, srcSet: parts.join(', '), width: width ?? null, height: height ?? null };
  }

  /** Набор для карточки товара: копия превью 320 px и само превью (кадрировано под карточку, 600–640 px). key — ключ оригинала фото. */
  cardSet(key: string | null | undefined): ImageSet | null {
    if (!key?.startsWith('public/') || !key.endsWith('.webp')) return null;
    const thumb = thumbOf(key);
    const parts = [...CARD_WIDTHS.map((w) => `${this.publicUrl(variantKey(thumb, w))} ${w}w`), `${this.publicUrl(thumb)} ${THUMB_WIDTH}w`];
    return { src: this.publicUrl(thumb)!, srcSet: parts.join(', '), width: null, height: null };
  }

  static join(...parts: string[]): string {
    return join(...parts).split(sep).join('/');
  }
}
