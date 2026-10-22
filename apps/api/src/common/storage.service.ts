import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

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
    await writeFile(full, data);
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

  static join(...parts: string[]): string {
    return join(...parts).split(sep).join('/');
  }
}
