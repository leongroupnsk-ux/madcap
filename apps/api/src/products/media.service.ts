import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MAX_PHOTO_MB, MAX_PHOTOS, MAX_VIDEO_MB, MAX_VIDEO_SECONDS } from '@aesculap/shared';
import type { ProductMedia } from '@prisma/client';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { JobsService } from '../common/jobs.service';
import { PrismaService } from '../common/prisma.service';
import { photoVariantKeys, thumbOf } from '../common/image-keys';
import { StorageService } from '../common/storage.service';
import { ThumbsService } from '../common/thumbs.service';
import { fetchRemote } from './remote-fetch';

const run = promisify(execFile);
export const MAX_VIDEOS = 2;

const thumbKey = thumbOf;

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger('Media');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly thumbs: ThumbsService,
  ) {}

  onModuleInit() {
    this.jobs.register('media:poster', (d: { mediaId: string }) => this.makePoster(d.mediaId));
  }

  view(m: ProductMedia) {
    return {
      id: m.id,
      type: m.type,
      url: this.storage.publicUrl(m.storageKey),
      thumbUrl: m.type === 'photo' ? this.storage.publicUrl(thumbKey(m.storageKey)) : this.storage.publicUrl(m.posterKey),
      posterUrl: this.storage.publicUrl(m.posterKey),
      isMain: m.isMain,
      colorId: m.colorId,
      position: m.position,
      approved: m.approved,
      width: m.width,
      height: m.height,
      durationS: m.durationS,
    };
  }

  /** Фото → WebP до 2000 px + превью 600 px + копии 320/640/1200 для srcset; метаданные (EXIF, геометки) не переносятся. */
  private async storePhoto(productId: string, input: Buffer) {
    let img: ReturnType<typeof sharp>;
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      img = sharp(input, { failOn: 'error' }).rotate();
      meta = await img.metadata();
    } catch {
      throw new BadRequestException({ message: 'Файл не похож на изображение' });
    }
    if (!meta.width || !meta.height || meta.width < 400 || meta.height < 400) {
      throw new BadRequestException({ message: 'Фото должно быть не меньше 400×400 px' });
    }
    const id = randomUUID();
    const key = `public/products/${productId}/${id}.webp`;
    const full = await img.clone().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await img.clone().resize({ width: 600, height: 800, fit: 'cover' }).webp({ quality: 78 }).toBuffer();
    await this.storage.put(key, full.data);
    await this.storage.put(thumbKey(key), thumb);
    await this.thumbs.ensurePhoto(key, full.data, thumb);
    return { id, key, width: full.info.width, height: full.info.height, size: full.data.length };
  }

  private async countMedia(productId: string) {
    const rows = await this.prisma.productMedia.groupBy({ by: ['type'], where: { productId }, _count: true });
    return { photo: rows.find((r) => r.type === 'photo')?._count ?? 0, video: rows.find((r) => r.type === 'video')?._count ?? 0 };
  }

  async addPhoto(productId: string, data: Buffer, sourceUrl?: string): Promise<ProductMedia> {
    if (data.length > MAX_PHOTO_MB * 1048576) throw new BadRequestException({ message: `Фото больше ${MAX_PHOTO_MB} МБ` });
    const counts = await this.countMedia(productId);
    if (counts.photo >= MAX_PHOTOS) throw new BadRequestException({ message: `Не больше ${MAX_PHOTOS} фото` });
    const stored = await this.storePhoto(productId, data);
    return this.prisma.productMedia.create({
      data: {
        id: stored.id,
        productId,
        type: 'photo',
        storageKey: stored.key,
        position: 100 + counts.photo,
        isMain: counts.photo === 0,
        width: stored.width,
        height: stored.height,
        sizeBytes: stored.size,
        sourceUrl,
      },
    });
  }

  async addPhotoFromUrl(productId: string, url: string): Promise<ProductMedia> {
    const existing = await this.prisma.productMedia.findFirst({ where: { productId, sourceUrl: url } });
    if (existing) return existing;
    const { data } = await fetchRemote(url, MAX_PHOTO_MB * 1048576, /^image\//);
    return this.addPhoto(productId, data, url);
  }

  /** Видео mp4 ≤ 100 МБ и ≤ 60 с, без перекодирования; постер — фоновой задачей (ТЗ §7.3). */
  async addVideo(productId: string, data: Buffer): Promise<ProductMedia> {
    if (data.length > MAX_VIDEO_MB * 1048576) throw new BadRequestException({ message: `Видео больше ${MAX_VIDEO_MB} МБ` });
    const counts = await this.countMedia(productId);
    if (counts.video >= MAX_VIDEOS) throw new BadRequestException({ message: `Не больше ${MAX_VIDEOS} видео` });
    const dir = await mkdtemp(join(tmpdir(), 'aesc-'));
    try {
      const file = join(dir, 'in.mp4');
      await writeFile(file, data);
      let probe: { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
      try {
        const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 20_000 });
        probe = JSON.parse(stdout);
      } catch {
        throw new BadRequestException({ message: 'Не удалось прочитать видео. Нужен файл mp4.' });
      }
      const duration = Number(probe.format?.duration ?? 0);
      const video = probe.streams?.find((s) => s.codec_type === 'video');
      if (!probe.format?.format_name?.includes('mp4') || !video) throw new BadRequestException({ message: 'Нужен файл mp4 с видеодорожкой' });
      if (duration > MAX_VIDEO_SECONDS + 0.5) throw new BadRequestException({ message: `Видео длиннее ${MAX_VIDEO_SECONDS} секунд` });
      const id = randomUUID();
      const key = `public/products/${productId}/${id}.mp4`;
      await this.storage.put(key, data);
      const media = await this.prisma.productMedia.create({
        data: { id, productId, type: 'video', storageKey: key, position: 200 + counts.video, durationS: duration, width: video.width, height: video.height, sizeBytes: data.length },
      });
      await this.jobs.enqueue('media:poster', { mediaId: id });
      return media;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async makePoster(mediaId: string) {
    const media = await this.prisma.productMedia.findUnique({ where: { id: mediaId } });
    if (!media || media.type !== 'video' || media.posterKey) return;
    const dir = await mkdtemp(join(tmpdir(), 'aesc-'));
    try {
      const out = join(dir, 'poster.png');
      const at = Math.min(1, (media.durationS ?? 1) / 2).toFixed(2);
      await run('ffmpeg', ['-v', 'error', '-ss', at, '-i', this.storage.localPath(media.storageKey), '-frames:v', '1', '-y', out], { timeout: 30_000 });
      const poster = await sharp(await readFile(out)).resize({ width: 1200, height: 1200, fit: 'inside' }).webp({ quality: 80 }).toBuffer();
      const posterKey = media.storageKey.replace(/\.mp4$/, '_poster.webp');
      await this.storage.put(posterKey, poster);
      await this.prisma.productMedia.update({ where: { id: mediaId }, data: { posterKey } });
    } catch (e) {
      this.logger.error(`Постер для ${mediaId}: ${(e as Error).message}`);
      throw e;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async deleteFiles(m: ProductMedia) {
    await this.storage.remove(m.storageKey);
    if (m.type === 'photo') for (const k of [thumbKey(m.storageKey), ...photoVariantKeys(m.storageKey)]) await this.storage.remove(k);
    await this.storage.remove(m.posterKey);
  }

  async deleteMedia(ids: string[]) {
    if (!ids.length) return;
    const rows = await this.prisma.productMedia.findMany({ where: { id: { in: ids } } });
    await this.prisma.productMedia.deleteMany({ where: { id: { in: ids } } });
    for (const m of rows) await this.deleteFiles(m);
  }
}
