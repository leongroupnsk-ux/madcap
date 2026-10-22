import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, agent, bootApp, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('анкета, фото и капсула', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: Agent;
  let supplierId: string;
  let spec: { id: string };
  let otherSpec: { id: string };

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    const admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
    for (const [slug, name, slot] of [['topy', 'Топы', 'top'], ['bryuki', 'Брюки', 'pants'], ['obuv', 'Обувь', 'shoes'], ['golovnye-ubory', 'Головные уборы', 'accessory']] as const) {
      await prisma.category.upsert({ where: { slug }, update: { slot }, create: { slug, name, slot } });
    }
    await prisma.color.upsert({ where: { name: 'Лаванда' }, update: {}, create: { name: 'Лаванда', hex: '#A99BD4', colorFamily: 'purple' } });
    await prisma.color.upsert({ where: { name: 'Терракота' }, update: {}, create: { name: 'Терракота', hex: '#C8553D', colorFamily: 'warm' } });
    spec = await prisma.specialty.findFirstOrThrow();
    otherSpec = await prisma.specialty.create({ data: { name: 'Педиатр', slug: `ped-${Date.now()}`, groupId: (await prisma.specialtyGroup.findFirstOrThrow()).id } });
    buyer = await makeUser(app, 'buyer@example.ru');
  });
  afterAll(async () => {
    await app.close();
  });

  let n = 0;
  async function product(title: string, category: string, color: string, price: number, opts: { sizes?: string[]; height?: string | null; gender?: 'female' | 'male' | 'unisex'; specs?: string[]; stock?: number; treatment?: string } = {}) {
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: category } });
    const c = await prisma.color.findUniqueOrThrow({ where: { name: color } });
    n += 1;
    return prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `p-${n}-${Date.now()}`, gender: opts.gender ?? 'unisex', moderationStatus: 'published', publishedAt: new Date(),
        treatment: opts.treatment ?? 'Антибактериальная', washing: 'до 60°',
        specialties: { create: (opts.specs ?? []).map((specialtyId) => ({ specialtyId })) },
        variants: { create: (opts.sizes ?? ['M']).map((size, i) => ({ sku: `S${n}-${i}`, size, heightRange: opts.height === undefined ? '170–176' : opts.height, colorId: c.id, price: price * 100, stock: opts.stock ?? 5 })) },
      },
    });
  }

  const fillQuiz = (a: Agent, extra: Record<string, unknown> = {}) =>
    a.put('/api/me/profile').set('Origin', ORIGIN).send({ gender: 'female', name: 'Елена', age: 31, heightCm: 172, weightKg: 60, sizeTop: 'M', sizeBottom: 'L', sizeShoes: '39', skinTone: 'cold', hair: 'light', eyes: 'light', specialtyIds: [spec.id], budgetRange: '10_15', ...extra });

  it('анкета сохраняется по шагам; цветотип, тип фигуры, заполненность; «создать профиль» проверяет обязательное', async () => {
    let res = await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ gender: 'female', name: 'Елена', age: 31 });
    expect(res.body).toMatchObject({ gender: 'female', quizCompleted: false });
    const early = await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ complete: true });
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/рост и размер.*специальность.*бюджет/);
    res = await fillQuiz(buyer);
    expect(res.body).toMatchObject({ colorType: 'summer', colorTypeLabel: 'Лето', bodyType: 'Треугольник', heightRange: '170–176', budgetLabel: '10 000–15 000 ₽' });
    expect(res.body.completenessPct).toBe(92);
    expect((await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ age: 12 })).status).toBe(400);
    expect((await agent(app).get('/api/me/profile')).status).toBe(401);
  });

  it('фото: только с согласием, приватны, без EXIF; отзыв согласия удаляет все фото', async () => {
    const img = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#88aa99' } }).withExif({ IFD0: { Make: 'SecretPhone', Copyright: 'GPS 55.75,37.61' } }).jpeg().toBuffer();
    expect((await sharp(img).metadata()).exif).toBeTruthy();
    const noConsent = await buyer.post('/api/me/photos').set('Origin', ORIGIN).attach('file', img, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(noConsent.status).toBe(403);
    await buyer.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'photos', granted: true });
    const up = await buyer.post('/api/me/photos').set('Origin', ORIGIN).field('angle', 'front').attach('file', img, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const photo = up.body.photos[0];
    const file = await buyer.get(photo.url).buffer(true).parse((r, cb) => { const ch: Buffer[] = []; r.on('data', (c: Buffer) => ch.push(c)); r.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(file.status).toBe(200);
    expect((await sharp(file.body).metadata()).exif).toBeUndefined();

    const stranger = await makeUser(app, 'other@example.ru');
    expect((await stranger.get(photo.url)).status).toBe(404);
    expect((await agent(app).get(photo.url)).status).toBe(401);
    const key = (await prisma.profilePhoto.findFirstOrThrow()).storageKey;
    expect(key.startsWith('private/')).toBe(true);
    expect((await agent(app).get(`/api/files/${key.replace(/^private\//, '')}`)).status).toBe(404);

    await buyer.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'photos', granted: false });
    expect(await prisma.profilePhoto.count()).toBe(0);
    expect((await buyer.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'pdn', granted: false })).status).toBe(400);
  });

  it('капсула: размер и ростовка профиля, пол, бюджет, 3 варианта по цвету, объяснения', async () => {
    // Подходящие (M, L, 39; 170–176)
    await product('Топ белый', 'topy', 'Белый', 2500, { specs: [spec.id] });
    await product('Топ лаванда', 'topy', 'Лаванда', 2900, { specs: [spec.id] });
    await product('Топ бирюза', 'topy', 'Бирюзовый', 2700);
    await product('Брюки белые', 'bryuki', 'Белый', 2300, { sizes: ['L'] });
    await product('Брюки лаванда', 'bryuki', 'Лаванда', 2600, { sizes: ['L'] });
    await product('Брюки бирюза', 'bryuki', 'Бирюзовый', 2400, { sizes: ['L'] });
    await product('Халат классика', 'halaty', 'Белый', 3500);
    await product('Халат дорогой', 'halaty', 'Белый', 9000, { specs: [spec.id] });
    await product('Сабо', 'obuv', 'Белый', 3990, { sizes: ['39'], height: null });
    await product('Шапочка', 'golovnye-ubory', 'Лаванда', 490, { sizes: ['ONE'], height: null });
    // Неподходящие: не тот размер, не та ростовка, мужское, нет в наличии
    await product('Топ XL', 'topy', 'Лаванда', 1000, { sizes: ['XL'] });
    await product('Топ высокий рост', 'topy', 'Лаванда', 1000, { height: '182–188' });
    await product('Топ мужской', 'topy', 'Лаванда', 1000, { gender: 'male' });
    await product('Топ закончился', 'topy', 'Лаванда', 1000, { stock: 0 });

    await fillQuiz(buyer, { complete: true });
    const cap = (await buyer.get('/api/me/capsule')).body;
    expect(cap.variants).toEqual([1, 2, 3]);
    const titles = cap.items.map((i: { product: { title: string } | null }) => i.product?.title);
    expect(titles).toHaveLength(5);
    expect(titles).not.toContain('Топ XL');
    expect(titles).not.toContain('Топ высокий рост');
    expect(titles).not.toContain('Топ мужской');
    expect(titles).not.toContain('Топ закончился');
    expect(titles).not.toContain('Халат дорогой'); // не влезает в 15 000
    expect(cap.total).toBeLessThanOrEqual(1_500_000);
    const top = cap.items.find((i: { slot: string }) => i.slot === 'top');
    const pants = cap.items.find((i: { slot: string }) => i.slot === 'pants');
    expect(top.variant.color).toBe(pants.variant.color);
    expect(pants.variant.size).toBe('L');
    expect(cap.explanations.join(' | ')).toMatch(/в одном цвете.*Лето.*В бюджете до 15\s000/u);

    const colorsByVariant = await Promise.all([1, 2, 3].map(async (v) => (await buyer.get(`/api/me/capsule?variant=${v}`)).body.items.find((i: { slot: string }) => i.slot === 'top').variant.color));
    expect(new Set(colorsByVariant).size).toBe(3);
  });

  it('замена вещи закрепляется и переживает пересборку; бюджет «без ограничений» берёт лучшее', async () => {
    await product('Топ белый', 'topy', 'Белый', 2500);
    await product('Топ лаванда', 'topy', 'Лаванда', 2900);
    await product('Брюки лаванда', 'bryuki', 'Лаванда', 2600, { sizes: ['L'] });
    await product('Халат классика', 'halaty', 'Белый', 3500);
    await product('Халат дорогой', 'halaty', 'Белый', 9000, { specs: [spec.id] });
    await fillQuiz(buyer, { complete: true, budgetRange: 'gt25' });
    let cap = (await buyer.get('/api/me/capsule')).body;
    expect(cap.items.find((i: { slot: string }) => i.slot === 'gown').product.title).toBe('Халат дорогой');
    expect(cap.items.find((i: { slot: string }) => i.slot === 'shoes').product).toBeNull();

    const alts = (await buyer.get('/api/me/capsule/1/gown/alternatives')).body;
    expect(alts.map((a: { title: string }) => a.title)).toEqual(['Халат классика']);
    cap = (await buyer.put('/api/me/capsule/1/gown').set('Origin', ORIGIN).send({ variantId: alts[0].variantId })).body;
    expect(cap.items.find((i: { slot: string }) => i.slot === 'gown')).toMatchObject({ pinned: true, product: { title: 'Халат классика' } });

    await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ hair: 'dark' });
    cap = (await buyer.get('/api/me/capsule')).body;
    expect(cap.items.find((i: { slot: string }) => i.slot === 'gown').product.title).toBe('Халат классика');

    const stranger = (await prisma.productVariant.findFirstOrThrow({ where: { product: { title: 'Топ белый' } } })).id;
    expect((await buyer.put('/api/me/capsule/1/gown').set('Origin', ORIGIN).send({ variantId: stranger })).status).toBe(400);
  });

  it('витрина: «Подходит вам» и рекомендованный размер только для покупателя с анкетой', async () => {
    const fit = await product('Топ мой', 'topy', 'Белый', 2500, { sizes: ['M', 'L'], specs: [spec.id] });
    await product('Топ чужой размер', 'topy', 'Белый', 2500, { sizes: ['XS'] });
    await product('Топ чужая специальность', 'topy', 'Белый', 2500, { specs: [otherSpec.id] });
    const guest = (await agent(app).get('/api/catalog/products')).body.items;
    expect(guest.every((i: { fits: boolean }) => !i.fits)).toBe(true);
    await fillQuiz(buyer, { complete: true });
    const mine = (await buyer.get('/api/catalog/products')).body.items;
    expect(mine.filter((i: { fits: boolean }) => i.fits).map((i: { title: string }) => i.title)).toEqual(['Топ мой']);
    const page = (await buyer.get(`/api/catalog/products/${fit.slug}`)).body;
    expect(page).toMatchObject({ fits: true, recommended: { size: 'M', heightRange: '170–176' } });
    expect((await buyer.get('/api/auth/me')).body.user.hasCapsule).toBe(true);
  });
});
