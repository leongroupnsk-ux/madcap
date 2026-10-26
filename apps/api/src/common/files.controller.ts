import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from './storage.service';
import { ThumbsService } from './thumbs.service';

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

/**
 * Отдача публичных файлов (медиа товаров, обложки). Ключи неизменяемые (uuid в имени, версия в имени копий — image-keys.ts),
 * поэтому кэш вечный: `public, max-age=31536000, immutable`. Копию по ширине, которой ещё нет, создаёт ThumbsService.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly thumbs: ThumbsService,
  ) {}

  @Get('*path')
  async get(@Param('path') path: string | string[], @Res() res: Response) {
    const rel = Array.isArray(path) ? path.join('/') : path;
    const key = `public/${rel}`;
    let exists = false;
    try {
      exists = (await this.storage.exists(key)) || (await this.thumbs.ensureVariant(key));
    } catch {
      exists = false;
    }
    if (!exists) throw new NotFoundException();
    res.setHeader('Content-Type', TYPES[rel.split('.').pop() ?? ''] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage.stream(key).pipe(res);
  }
}
