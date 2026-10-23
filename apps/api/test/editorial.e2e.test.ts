import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, agent, bootApp, jpeg, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('журнал редакции площадки', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
  });

  it('редакция пишет статью с товарами любых поставщиков и публикует без модерации', async () => {
    const { agent: sup, supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
    const brand = await prisma.brand.create({ data: { name: 'Б', slug: 'b' } });
    const cat = await prisma.category.findFirstOrThrow();
    const color = await prisma.color.findFirstOrThrow();
    const product = await prisma.product.create({
      data: { supplierId, brandId: brand.id, categoryId: cat.id, title: 'Костюм', slug: 'k-ed', gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(), variants: { create: { sku: 'K', size: 'M', colorId: color.id, price: 100000, stock: 3 } } },
    });
    const draft = await prisma.product.create({ data: { supplierId, brandId: brand.id, categoryId: cat.id, title: 'Черновик', slug: 'd-ed', gender: 'unisex' } });

    const cover = await admin.post('/api/admin/editorial/image').set('Origin', ORIGIN).attach('file', await jpeg(3), { filename: 'c.jpg', contentType: 'image/jpeg' }).expect(201);
    const body = { title: 'Как выбрать форму на смену', lead: 'Советы редакции', coverKey: cover.body.key, body: '<p>Коротко</p>', productIds: [product.id] };
    expect((await admin.post('/api/admin/editorial/articles').set('Origin', ORIGIN).send({ ...body, productIds: [draft.id] })).status).toBe(400);
    const a = (await admin.post('/api/admin/editorial/articles').set('Origin', ORIGIN).send(body).expect(201)).body;
    // Короткий текст не публикуется
    expect((await admin.post(`/api/admin/editorial/article/${a.id}/publish`).set('Origin', ORIGIN)).status).toBe(400);
    await admin.put(`/api/admin/editorial/articles/${a.id}`).set('Origin', ORIGIN).send({ ...body, body: `<p>${'Ткань, посадка и уход. '.repeat(15)}</p>` }).expect(200);
    const pub = await admin.post(`/api/admin/editorial/article/${a.id}/publish`).set('Origin', ORIGIN).expect(200);
    expect(pub.body.status).toBe('published');

    const journal = (await agent(app).get('/api/journal')).body;
    const item = (journal.items ?? journal).find((x: { slug: string }) => x.slug === a.slug);
    expect(item.author).toBe('aesculap');
    // Правка опубликованной статьи редакции не снимает её с публикации
    await admin.put(`/api/admin/editorial/articles/${a.id}`).set('Origin', ORIGIN).send({ ...body, title: 'Новая редакция', body: `<p>${'Текст '.repeat(60)}</p>` }).expect(200);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('published');

    // Поставщик не видит редакцию; статья поставщика не попадает в список редакции
    expect((await sup.get('/api/admin/editorial')).status).toBe(403);
    expect((await admin.get('/api/admin/editorial')).body.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });
});
