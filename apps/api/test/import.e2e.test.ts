import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { remoteFetchOptions } from '../src/products/remote-fetch';
import { ORIGIN, bootApp, fileServer, jpeg, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

const HEAD = ['Артикул модели', 'Название', 'Бренд', 'Категория', 'Пол', 'Описание', 'Специальности', 'SKU', 'Размер', 'Ростовка', 'Цвет', 'Цена, ₽', 'Старая цена, ₽', 'Остаток, шт', 'Вес, г', 'Длина, мм', 'Ширина, мм', 'Высота, мм', 'Фото (ссылки через |)'];

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Товары');
  ws.addRow(HEAD);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('импорт каталога', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sup: Agent;
  let supplierId: string;
  let server: Awaited<ReturnType<typeof fileServer>>;
  let feed = '';

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    server = await fileServer({
      '/1.jpg': async () => ({ type: 'image/jpeg', body: await jpeg(1) }),
      '/2.jpg': async () => ({ type: 'image/jpeg', body: await jpeg(2) }),
      '/3.jpg': async () => ({ type: 'image/jpeg', body: await jpeg(3) }),
      '/tiny.jpg': async () => ({ type: 'image/jpeg', body: await jpeg(4, 100) }),
      '/feed.xml': async () => ({ type: 'application/xml', body: feed }),
    });
  });
  beforeEach(async () => {
    await resetDb(app);
    const admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ agent: sup, supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
  });
  afterAll(async () => {
    await server.close();
    await app.close();
  });

  const photos = () => `${server.base}/1.jpg|${server.base}/2.jpg|${server.base}/3.jpg`;
  const row = (sku: string, size: string, stock: number, extra: Partial<Record<number, string | number>> = {}) => {
    const r: (string | number)[] = ['MT-1101', 'Костюм «Хирург»', 'МедТекс', 'Костюмы', 'Унисекс', 'Скраб-костюм', 'Хирург', sku, size, '170–176', 'Бирюзовый', 4590, 5290, stock, 600, 300, 250, 50, photos()];
    for (const [i, v] of Object.entries(extra)) r[Number(i)] = v;
    return r;
  };
  const upload = async (buf: Buffer, name = 'catalog.xlsx') => {
    const res = await sup.post('/api/supplier/import/file').set('Origin', ORIGIN).attach('file', buf, name);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (await sup.get(`/api/supplier/import/${res.body.id}`)).body;
  };

  it('шаблон скачивается и содержит колонки', async () => {
    const res = await sup.get('/api/supplier/import/template.xlsx').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.getWorksheet('Товары')!.getRow(1).getCell(1).value).toBe('Артикул модели');
  });

  it('проверка без записи: счётчики и ошибки по строкам; применение создаёт товар с фото', async () => {
    const job = await upload(
      await xlsx([
        row('MT-1101-M', 'M', 12),
        row('MT-1101-L', 'L', 7),
        row('MT-1101-XL', 'XL', 3, { 10: 'Фиолетовый' }),
        row('MT-1101-S', 'S', -1),
        row('MT-1101-M', 'M', 1),
      ]),
    );
    expect(job).toMatchObject({ status: 'checked', totalRows: 5, newProducts: 2, updates: 0, errorRows: 3 });
    expect(job.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`)).toEqual(['4:color', '5:stock', '6:sku']);
    expect(await prisma.product.count()).toBe(0);

    const applied = await sup.post(`/api/supplier/import/${job.id}/apply`).set('Origin', ORIGIN);
    expect(applied.body.status).toBe('applied');
    const p = await prisma.product.findFirstOrThrow({ where: { supplierId }, include: { variants: true, media: true, specialties: true } });
    expect(p).toMatchObject({ externalId: 'MT-1101', source: 'file', moderationStatus: 'pending' });
    expect(p.variants.map((v) => v.sku).sort()).toEqual(['MT-1101-L', 'MT-1101-M']);
    expect(p.media).toHaveLength(3);
    expect(p.specialties).toHaveLength(1);
  });

  it('повторный импорт: цены и остатки обновляются, ручные правки не перетираются', async () => {
    const first = await upload(await xlsx([row('MT-1101-M', 'M', 12)]));
    await sup.post(`/api/supplier/import/${first.id}/apply`).set('Origin', ORIGIN);
    await prisma.product.updateMany({ data: { manualOverride: true, title: 'Название от поставщика вручную' } });

    const second = await upload(await xlsx([row('MT-1101-M', 'M', 2, { 11: 3990 })]));
    expect(second).toMatchObject({ newProducts: 0, updates: 1 });
    await sup.post(`/api/supplier/import/${second.id}/apply`).set('Origin', ORIGIN);
    const p = await prisma.product.findFirstOrThrow({ include: { variants: true } });
    expect(p.variants[0]).toMatchObject({ stock: 2, price: 399000 });
    expect(p.title).toBe('Название от поставщика вручную');
  });

  it('CSV с разделителем «;» и битые фото попадают в отчёт', async () => {
    const csv = [HEAD.join(';'), row('MT-1101-M', 'M', 5, { 18: `${server.base}/1.jpg|${server.base}/tiny.jpg|${server.base}/missing.jpg` }).join(';')].join('\n');
    const job = await upload(Buffer.from(csv, 'utf8'), 'catalog.csv');
    expect(job.status).toBe('checked');
    await sup.post(`/api/supplier/import/${job.id}/apply`).set('Origin', ORIGIN);
    const after = (await sup.get(`/api/supplier/import/${job.id}`)).body;
    expect(after.errors.map((e: { message: string }) => e.message).join('\n')).toMatch(/400×400[\s\S]*404/);
    const p = await prisma.product.findFirstOrThrow({ include: { media: true } });
    expect(p.media).toHaveLength(1);
    expect(p.moderationStatus).toBe('pending');
  });

  it('файл без нужных колонок — понятная ошибка', async () => {
    const res = await sup.post('/api/supplier/import/file').set('Origin', ORIGIN).attach('file', Buffer.from('a;b\n1;2'), 'x.csv');
    const job = (await sup.get(`/api/supplier/import/${res.body.id}`)).body;
    expect(job.status).toBe('failed');
    expect(job.failReason).toMatch(/Не нашли строку заголовков/);
  });

  it('YML-фид: синк с автоприменением, пропавшие позиции обнуляются', async () => {
    const offer = (id: string, size: string, count: number) =>
      `<offer id="${id}" group_id="G1" available="true"><name>Халат «Доктор»</name><vendor>Форма+</vendor><price>6290</price><categoryId>2</categoryId>` +
      `<picture>${server.base}/1.jpg</picture><picture>${server.base}/2.jpg</picture><picture>${server.base}/3.jpg</picture>` +
      `<description>&lt;p&gt;Медицинский халат&lt;/p&gt;</description><param name="Размер">${size}</param><param name="Цвет">Белый</param>` +
      `<count>${count}</count><weight>0.7</weight><dimensions>30/25/5</dimensions></offer>`;
    const doc = (offers: string) => `<?xml version="1.0"?><yml_catalog><shop><categories><category id="2">Халаты</category></categories><offers>${offers}</offers></shop></yml_catalog>`;
    feed = doc(offer('H-M', 'M', 4) + offer('H-L', 'L', 2));
    const set = await sup.put('/api/supplier/import/feed').set('Origin', ORIGIN).send({ url: `${server.base}/feed.xml` });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const job = (await sup.get(`/api/supplier/import/${set.body.id}`)).body;
    expect(job).toMatchObject({ status: 'applied', totalRows: 2, errorRows: 0 });
    let p = await prisma.product.findFirstOrThrow({ include: { variants: true, media: true } });
    expect(p).toMatchObject({ source: 'yml', externalId: 'G1', description: 'Медицинский халат' });
    expect(p.variants.find((v) => v.sku === 'H-M')).toMatchObject({ weightG: 700, lengthMm: 300 });

    feed = doc(offer('H-M', 'M', 9));
    await sup.post('/api/supplier/import/feed/sync').set('Origin', ORIGIN);
    p = await prisma.product.findFirstOrThrow({ include: { variants: true, media: true } });
    expect(p.variants.find((v) => v.sku === 'H-M')!.stock).toBe(9);
    expect(p.variants.find((v) => v.sku === 'H-L')!.stock).toBe(0);
  });

  it('SSRF: фид на внутренний адрес отклоняется', async () => {
    remoteFetchOptions.allowPrivate = false;
    try {
      const set = await sup.put('/api/supplier/import/feed').set('Origin', ORIGIN).send({ url: `${server.base}/feed.xml` });
      const job = (await sup.get(`/api/supplier/import/${set.body.id}`)).body;
      expect(job.status).toBe('failed');
      expect(job.failReason).toMatch(/внутренней сети/);
    } finally {
      remoteFetchOptions.allowPrivate = true;
    }
  });
});
