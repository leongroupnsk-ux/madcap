import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, bootApp, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('админка: справочники', () => {
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
    // Справочники resetDb не чистит — убираем свои тестовые записи
    await prisma.specialty.deleteMany({ where: { name: { endsWith: ' тест' } } });
    await prisma.specialtyGroup.deleteMany({ where: { name: { endsWith: ' тест' } } });
    await prisma.color.deleteMany({ where: { name: { endsWith: ' тест' } } });
    await prisma.category.deleteMany({ where: { name: { endsWith: ' тест' }, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: { name: { endsWith: ' тест' } } });
  });

  const post = (path: string, body: object) => admin.post(`/api/admin/dictionaries/${path}`).set('Origin', ORIGIN).send(body);
  const put = (path: string, body: object) => admin.put(`/api/admin/dictionaries/${path}`).set('Origin', ORIGIN).send(body);
  const del = (path: string) => admin.delete(`/api/admin/dictionaries/${path}`).set('Origin', ORIGIN);

  it('категории: дерево в два уровня, уникальный адрес, удаление только пустых', async () => {
    let d = (await post('categories', { name: 'Обувь тест', slug: 'obuv-test', slot: 'shoes' }).expect(201)).body;
    const root = d.categories.find((c: any) => c.slug === 'obuv-test');
    d = (await post('categories', { name: 'Сабо тест', parentId: root.id }).expect(201)).body;
    const child = d.categories.find((c: any) => c.name === 'Сабо тест');
    expect(child.slug).toBe('sabo-test');
    expect((await post('categories', { name: 'Третий уровень', parentId: child.id })).status).toBe(400);
    expect((await post('categories', { name: 'Дубль', slug: 'obuv-test' })).status).toBe(409);
    expect((await put(`categories/${root.id}`, { name: 'Обувь', slug: 'obuv-test', parentId: child.id })).status).toBe(400);
    expect((await del(`categories/${root.id}`)).status).toBe(409);
    await del(`categories/${child.id}`).expect(200);
    await del(`categories/${root.id}`).expect(200);
  });

  it('специальности: слоты капсулы, удаление занятой запрещено; цвета и бренды', async () => {
    let d = (await post('specialty-groups', { name: 'Стоматология тест' }).expect(201)).body;
    const g = d.specialtyGroups.find((x: any) => x.name === 'Стоматология тест');
    d = (await post('specialties', { name: 'Ортодонт тест', groupId: g.id, slots: ['top', 'pants', 'shoes'] }).expect(201)).body;
    const spec = d.specialtyGroups.find((x: any) => x.id === g.id).specialties[0];
    expect(spec.slots).toEqual(['top', 'pants', 'shoes']);
    expect((await prisma.specialty.findUniqueOrThrow({ where: { id: spec.id } })).rules).toEqual({ slots: ['top', 'pants', 'shoes'] });
    expect((await del(`specialty-groups/${g.id}`)).status).toBe(409);

    expect((await post('colors', { name: 'Хаки тест', hex: 'зелёный', colorFamily: 'green' })).status).toBe(400);
    d = (await post('colors', { name: 'Хаки тест', hex: '#6b8e23', colorFamily: 'green' }).expect(201)).body;
    expect(d.colors.find((c: any) => c.name === 'Хаки тест').hex).toBe('#6B8E23');

    // Объединение дублей бренда: товары переезжают, дубль удаляется
    const { supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const [a, b] = await Promise.all([prisma.brand.create({ data: { name: 'Медтекс', slug: 'medteks-1' } }), prisma.brand.create({ data: { name: 'МедТекс', slug: 'medteks-2' } })]);
    const cat = await prisma.category.findFirstOrThrow();
    await prisma.product.create({ data: { supplierId, brandId: a.id, categoryId: cat.id, title: 'Т', slug: 't-1', gender: 'unisex' } });
    expect((await del(`brands/${a.id}`)).status).toBe(409);
    await admin.post(`/api/admin/dictionaries/brands/${a.id}/merge`).set('Origin', ORIGIN).send({ intoId: b.id }).expect(200);
    expect(await prisma.product.count({ where: { brandId: b.id } })).toBe(1);
    expect(await prisma.brand.findUnique({ where: { id: a.id } })).toBeNull();
    const chart = { clothes: { columns: ['Размер', 'Грудь'], rows: [['M', '92']] }, shoes: { columns: ['RU', 'См'], rows: [['38', '24.5']] } };
    await put(`brands/${b.id}`, { name: 'МедТекс', sizeChart: chart }).expect(200);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: b.id } })).sizeChart).toEqual(chart);

    const buyer = await makeUser(app, 'buyer@example.ru');
    expect((await buyer.get('/api/admin/dictionaries')).status).toBe(403);
  });
});
