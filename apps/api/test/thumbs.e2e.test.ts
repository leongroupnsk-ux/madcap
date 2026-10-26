import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { photoVariantKeys, thumbOf, variantKey } from '../src/common/image-keys';
import { PrismaService } from '../src/common/prisma.service';
import { StorageService } from '../src/common/storage.service';
import { backfillThumbs } from '../src/common/thumbs-backfill';
import { ThumbsService } from '../src/common/thumbs.service';
import { ORIGIN, agent, dictionaries, jpeg, makeSupplier, makeUser, resetDb, bootApp, type Agent } from './helpers';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const url = (key: string) => `/api/files/${key.slice('public/'.length)}`;

describe('копии фото по ширине (srcset)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let sup: Agent;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
  });
  beforeEach(async () => {
    await resetDb(app);
    const admin = await makeUser(app, 'admin@example.ru', 'admin');
    sup = (await makeSupplier(app, admin, 'owner@thumbs.ru', '7707083893')).agent;
  });
  afterAll(async () => {
    await app.close();
  });

  async function photo(size = 1600) {
    const d = await dictionaries(sup);
    const brand = await sup.post('/api/supplier/brands').set('Origin', ORIGIN).send({ name: 'Бренд' });
    const product = await sup.post('/api/supplier/products').set('Origin', ORIGIN).send({
      title: 'Костюм', brandId: brand.body.id, categoryId: d.categories[0].id, gender: 'unisex', fabric: '', treatment: '', washing: '', description: '',
      specialtyIds: [], variants: [{ sku: 'T-1', size: 'M', heightRange: null, colorId: d.colors[0].id, price: 1000, oldPrice: null, stock: 1, weightG: 500, lengthMm: 300, widthMm: 250, heightMm: 50 }], media: { order: [], mainId: null },
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const res = await sup.post(`/api/supplier/products/${product.body.id}/media`).set('Origin', ORIGIN).attach('file', await jpeg(1, size), { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return prisma.productMedia.findFirstOrThrow({ where: { productId: product.body.id } });
  }

  const widthOf = async (key: string) => (await sharp(await storage.read(key)).metadata()).width;

  it('при загрузке фото создаются копии 320/640/1200 и копия превью 320; отдаются с вечным кэшем', async () => {
    const m = await photo(1600);
    expect(await widthOf(variantKey(m.storageKey, 320))).toBe(320);
    expect(await widthOf(variantKey(m.storageKey, 640))).toBe(640);
    expect(await widthOf(variantKey(m.storageKey, 1200))).toBe(1200);
    expect(await widthOf(variantKey(thumbOf(m.storageKey), 320))).toBe(320);
    expect(variantKey(m.storageKey, 320)).toMatch(/_w320\.v1\.webp$/);

    for (const key of [m.storageKey, thumbOf(m.storageKey), ...photoVariantKeys(m.storageKey)]) {
      const res = await agent(app).get(url(key));
      expect(res.status, key).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toBe(IMMUTABLE);
    }

    // Набор для srcset: копии не шире оригинала, src — средняя копия
    const set = storage.imageSet(m.storageKey, m.width, m.height)!;
    expect(set.src).toBe(url(variantKey(m.storageKey, 640)));
    expect(set.srcSet).toBe([320, 640, 1200].map((w) => `${url(variantKey(m.storageKey, w))} ${w}w`).join(', '));
    expect(set).toMatchObject({ width: 1600, height: 1600 });
    const card = storage.cardSet(m.storageKey)!;
    expect(card.srcSet).toBe(`${url(variantKey(thumbOf(m.storageKey), 320))} 320w, ${url(thumbOf(m.storageKey))} 640w`);
  });

  it('фото меньше 1200 px: копия не увеличивается, в srcset — настоящая ширина', async () => {
    const m = await photo(800);
    expect(await widthOf(variantKey(m.storageKey, 1200))).toBe(800);
    const set = storage.imageSet(m.storageKey, m.width, m.height)!;
    expect(set.srcSet.split(', ').map((s) => s.split(' ')[1])).toEqual(['320w', '640w', '800w']);
  });

  it('копия, которой нет (фото загружено раньше), создаётся при первом запросе; чужие размеры и пути — 404', async () => {
    const m = await photo(1600);
    const key = variantKey(m.storageKey, 640);
    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
    const res = await agent(app).get(url(key));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(await widthOf(key)).toBe(640);

    // Ширина не из списка, копия копии, нет исходника, приватные файлы
    expect((await agent(app).get(url(m.storageKey.replace(/\.webp$/, '_w999.v1.webp')))).status).toBe(404);
    expect((await agent(app).get(url(variantKey(thumbOf(m.storageKey), 640)))).status).toBe(404);
    expect((await agent(app).get(url(variantKey(key, 320)))).status).toBe(404);
    expect((await agent(app).get('/api/files/products/nope/none_w320.v1.webp')).status).toBe(404);
    expect((await agent(app).get('/api/files/../private/x_w320.v1.webp')).status).toBe(404);
  });

  it('бэкфилл досоздаёт недостающие копии фото и обложек и идемпотентен', async () => {
    const m = await photo(1600);
    const cover = await app.get(PrismaService).article.create({ data: { title: 'Статья', slug: 'statya-thumbs', body: '<p>x</p>', coverKey: `public/content/${randomUUID()}.webp` } });
    await storage.put(cover.coverKey!, await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#7a9' } }).webp().toBuffer());
    for (const k of photoVariantKeys(m.storageKey)) await storage.remove(k);

    const thumbs = app.get(ThumbsService);
    const first = await backfillThumbs(prisma, thumbs);
    expect(first).toMatchObject({ sources: 2, made: 4 + 3, missing: 0 });
    for (const k of photoVariantKeys(m.storageKey)) expect(await storage.exists(k)).toBe(true);
    expect(await widthOf(variantKey(cover.coverKey!, 1200))).toBe(1000);

    const mtime = (await stat(storage.localPath(variantKey(m.storageKey, 320)))).mtimeMs;
    const second = await backfillThumbs(prisma, thumbs);
    expect(second).toMatchObject({ sources: 2, made: 0, missing: 0 });
    expect((await stat(storage.localPath(variantKey(m.storageKey, 320)))).mtimeMs).toBe(mtime);

    // Фото без файла в хранилище не роняет бэкфилл
    await prisma.productMedia.create({ data: { productId: m.productId, type: 'photo', storageKey: 'public/products/none/lost.webp', position: 101 } });
    expect(await backfillThumbs(prisma, thumbs)).toMatchObject({ made: 0, missing: 1 });
  });

  it('удаление фото убирает и копии', async () => {
    const m = await photo(1200);
    const keys = photoVariantKeys(m.storageKey);
    await app.get((await import('../src/products/media.service')).MediaService).deleteMedia([m.id]);
    for (const k of [m.storageKey, thumbOf(m.storageKey), ...keys]) expect(await storage.exists(k)).toBe(false);
  });
});
