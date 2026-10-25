import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, agent, bootApp, dictionaries, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('премиум: анкета, капсула, заявка, админка', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let supplier: Agent;
  let supplierId: string;
  let groupId: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ agent: supplier, supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
    for (const [slug, name, slot] of [['topy', 'Топы', 'top'], ['bryuki', 'Брюки', 'pants'], ['obuv', 'Обувь', 'shoes'], ['aksessuary', 'Аксессуары', 'accessory']] as const) {
      await prisma.category.upsert({ where: { slug }, update: { slot }, create: { slug, name, slot } });
    }
    await prisma.color.upsert({ where: { name: 'Тёмно-синий' }, update: {}, create: { name: 'Тёмно-синий', hex: '#1F2A4D', colorFamily: 'blue' } });
    groupId = (await prisma.specialtyGroup.findFirstOrThrow()).id;
  });
  afterAll(async () => {
    await app.close();
  });

  let n = 0;
  async function product(title: string, category: string, color: string, price: number, premium: boolean, sizes = ['M']) {
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: category } });
    const c = await prisma.color.findUniqueOrThrow({ where: { name: color } });
    n += 1;
    return prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `pr-${n}-${Date.now()}`, gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(), premium,
        variants: { create: sizes.map((size, i) => ({ sku: `P${n}-${i}`, size, heightRange: null, colorId: c.id, price: price * 100, stock: 5 })) },
      },
      include: { variants: true },
    });
  }

  /** Премиальный набор во всех слотах + дешёвые обычные товары, которые обычный подбор выбрал бы первыми */
  async function catalog() {
    const top = await product('Топ «Уют»', 'topy', 'Тёмно-синий', 4590, true);
    const top2 = await product('Топ «Элит»', 'topy', 'Тёмно-синий', 5200, true);
    await product('Брюки «Уют»', 'bryuki', 'Тёмно-синий', 4230, true, ['L']);
    await product('Халат «Классика»', 'halaty', 'Белый', 3890, true);
    await product('Сабо «Light»', 'obuv', 'Белый', 5590, true, ['38']);
    await product('Бейдж', 'aksessuary', 'Белый', 490, true, ['ONE']);
    await product('Топ обычный', 'topy', 'Тёмно-синий', 990, false);
    await product('Брюки обычные', 'bryuki', 'Тёмно-синий', 990, false, ['L']);
    await product('Халат обычный', 'halaty', 'Белый', 990, false);
    const topSmall = await product('Топ премиум XS', 'topy', 'Тёмно-синий', 4000, true, ['XS']);
    return { top, top2, topSmall };
  }

  const answers = () => ({
    gender: 'female', name: 'Елена', age: 31, heightCm: 172, weightKg: 60, sizeTop: 'M', sizeBottom: 'L', sizeShoes: '38',
    skinTone: 'cold', hair: 'light', eyes: 'light', specialtyGroupIds: [groupId], budgetRange: 'gt30',
  });

  it('капсула считается гостем только из премиальных товаров и не пишется в базу', async () => {
    const { top, top2, topSmall } = await catalog();
    const guest = agent(app);
    const res = await guest.post('/api/premium/capsule').set('Origin', ORIGIN).send({ answers: answers() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const titles = res.body.items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Брюки «Уют»', 'Халат «Классика»', 'Сабо «Light»', 'Бейдж']));
    expect(titles.some((t: string) => t.includes('обычн'))).toBe(false);
    expect(titles).not.toContain('Топ премиум XS');
    expect(res.body.count).toBe(5);
    expect(res.body.total).toBe(res.body.items.reduce((s: number, i: { price: number }) => s + i.price, 0));
    expect(res.body.title).toBe('Тёмно-синяя капсула');
    expect(await prisma.capsule.count()).toBe(0);
    expect(await prisma.capsuleItem.count()).toBe(0);

    // Замена: альтернатива в слоте — только среди premium; чужой размер и обычный товар не принимаются
    const topItem = res.body.items.find((i: { slot: string }) => i.slot === 'top');
    const alt = topItem.alternatives.find((x: { productId: string }) => x.productId !== topItem.productId);
    expect([top.id, top2.id]).toContain(alt.productId);
    const replaced = await guest.post('/api/premium/capsule').set('Origin', ORIGIN).send({ answers: answers(), overrides: { top: alt.variantId } });
    expect(replaced.body.items.find((i: { slot: string }) => i.slot === 'top').variantId).toBe(alt.variantId);
    const bad = await guest.post('/api/premium/capsule').set('Origin', ORIGIN).send({ answers: answers(), overrides: { top: topSmall.variants[0].id } });
    expect(bad.body.items.find((i: { slot: string }) => i.slot === 'top').variantId).not.toBe(topSmall.variants[0].id);

    // Без обязательных ответов — понятная ошибка
    const empty = await guest.post('/api/premium/capsule').set('Origin', ORIGIN).send({ answers: { gender: 'female' } });
    expect(empty.status).toBe(400);
  });

  it('заявка: валидация телефона и согласия, снимок капсулы, письмо и аудит, лимит частоты по IP', async () => {
    await catalog();
    const guest = agent(app);
    const base = { name: 'Анна', phone: '+7 (999) 123-45-67', contact: 'whatsapp', consent: true, answers: answers(), variantNo: 1 };
    const badPhone = await guest.post('/api/premium/leads').set('Origin', ORIGIN).send({ ...base, phone: '8 999 123 45 67' });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.errors.phone).toMatch(/\+7/);
    const noConsent = await guest.post('/api/premium/leads').set('Origin', ORIGIN).send({ ...base, consent: false });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.errors.consent).toBeTruthy();
    const shortName = await guest.post('/api/premium/leads').set('Origin', ORIGIN).send({ ...base, name: 'А' });
    expect(shortName.status).toBe(400);

    const ok = await guest.post('/api/premium/leads').set('Origin', ORIGIN).send(base);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const lead = await prisma.premiumLead.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(lead).toMatchObject({ name: 'Анна', phone: '+79991234567', contact: 'whatsapp', status: 'new', userId: null });
    const snap = lead.capsule as { items: { title: string; price: number }[]; total: number };
    expect(snap.items).toHaveLength(5);
    expect(snap.total).toBe(snap.items.reduce((s, i) => s + i.price, 0));
    expect(await prisma.auditLog.count({ where: { action: 'premium.lead.create', entityId: lead.id } })).toBe(1);

    // Вошедший покупатель — заявка привязана к нему
    const buyer = await makeUser(app, 'buyer@example.ru');
    const mine = await buyer.post('/api/premium/leads').set('Origin', ORIGIN).send({ ...base, contact: 'phone' });
    expect(mine.status).toBe(201);
    expect((await prisma.premiumLead.findUniqueOrThrow({ where: { id: mine.body.id } })).userId).toBeTruthy();

    // Лимит: 5 заявок в час с одного IP (уже 2 успешных + 3 отклонённых валидацией не считаются)
    let last = 201;
    for (let i = 0; i < 4; i++) last = (await guest.post('/api/premium/leads').set('Origin', ORIGIN).send(base)).status;
    expect(last).toBe(429);
  });

  it('админ видит заявку и меняет статус; поставщик и покупатель — нет', async () => {
    await catalog();
    const created = await agent(app).post('/api/premium/leads').set('Origin', ORIGIN).send({ name: 'Анна', phone: '+79991234567', contact: 'phone', consent: true, answers: answers() });
    const id = created.body.id;
    const list = await admin.get('/api/admin/premium');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id, name: 'Анна', status: 'new', count: 5 });
    expect(list.body.counts.new).toBe(1);
    const card = await admin.get(`/api/admin/premium/${id}`);
    expect(card.body.capsule.items).toHaveLength(5);
    expect(card.body.answers.sizeTop).toBe('M');
    expect(card.body.workplaces).toEqual(['Хирургия']);

    const upd = await admin.put(`/api/admin/premium/${id}`).set('Origin', ORIGIN).send({ status: 'in_progress', managerComment: 'Перезвонить вечером' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ status: 'in_progress', managerComment: 'Перезвонить вечером' });
    expect(await prisma.auditLog.count({ where: { action: 'premium.lead.update', entityId: id } })).toBe(1);
    expect((await admin.get('/api/admin/premium?status=done')).body.items).toHaveLength(0);
    expect((await admin.put(`/api/admin/premium/${id}`).set('Origin', ORIGIN).send({ status: 'lost' })).status).toBe(400);

    // Поддержка видит раздел, редактор — нет
    const support = await makeUser(app, 'support@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'support@example.ru' }, data: { staffRole: 'support' } });
    expect((await support.get('/api/admin/premium')).status).toBe(200);
    const editor = await makeUser(app, 'editor@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'editor@example.ru' }, data: { staffRole: 'editor' } });
    expect((await editor.get('/api/admin/premium')).status).toBe(403);

    const buyer = await makeUser(app, 'buyer@example.ru');
    expect((await buyer.get('/api/admin/premium')).status).toBe(403);
    expect((await supplier.get('/api/admin/premium')).status).toBe(403);
    expect((await agent(app).get('/api/admin/premium')).status).toBe(401);
  });

  it('ответы анкеты вошедшего сохраняются по шагам; «завершить» проверяет обязательное', async () => {
    const buyer = await makeUser(app, 'buyer@example.ru');
    expect((await agent(app).get('/api/premium/answers')).status).toBe(401);
    let res = await buyer.put('/api/premium/answers').set('Origin', ORIGIN).send({ gender: 'female', name: 'Елена', age: 31 });
    expect(res.body).toMatchObject({ answers: { gender: 'female', name: 'Елена' }, completed: false });
    expect((await buyer.put('/api/premium/answers').set('Origin', ORIGIN).send({ complete: true })).status).toBe(400);
    res = await buyer.put('/api/premium/answers').set('Origin', ORIGIN).send({ ...answers(), complete: true });
    expect(res.body.completed).toBe(true);
    expect(res.body.answers.specialtyGroupIds).toEqual([groupId]);
    expect((await buyer.put('/api/premium/answers').set('Origin', ORIGIN).send({ budgetRange: 'lt5' })).status).toBe(400);
  });

  it('поставщик отмечает товар как премиальный: флаг сохраняется, у опубликованного — через модерацию', async () => {
    const d = await dictionaries(supplier);
    const brand = await supplier.post('/api/supplier/brands').set('Origin', ORIGIN).send({ name: 'МедТекс Премиум' });
    const body = {
      title: 'Топ «Уют»', brandId: brand.body.id, categoryId: d.categories[0].id, gender: 'unisex', fabric: '', treatment: '', washing: '', description: '',
      specialtyIds: [], premium: true,
      variants: [{ sku: 'UYUT-M', size: 'M', heightRange: null, colorId: d.colors[0].id, price: 4590, oldPrice: null, stock: 3, weightG: 300, lengthMm: 300, widthMm: 250, heightMm: 50 }],
      media: { order: [], mainId: null },
    };
    const created = await supplier.post('/api/supplier/products').set('Origin', ORIGIN).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.premium).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.body.id } })).premium).toBe(true);
    const off = await supplier.put(`/api/supplier/products/${created.body.id}`).set('Origin', ORIGIN).send({ ...body, premium: false });
    expect(off.body.premium).toBe(false);

    // Опубликованный товар: флаг уходит в правку на модерацию и применяется после одобрения
    await prisma.product.update({ where: { id: created.body.id }, data: { moderationStatus: 'published', publishedAt: new Date() } });
    const rev = await supplier.put(`/api/supplier/products/${created.body.id}`).set('Origin', ORIGIN).send({ ...body, premium: true });
    expect(rev.body.premium).toBe(true);
    expect(rev.body.revision?.status).toBe('pending');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.body.id } })).premium).toBe(false);
    await admin.post(`/api/admin/moderation/revisions/${rev.body.revision.id}/approve`).set('Origin', ORIGIN);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.body.id } })).premium).toBe(true);
  });
});
