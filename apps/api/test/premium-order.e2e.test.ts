import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, PASSWORD, agent, bootApp, mails, makeSupplier, makeUser, resetDb, tokenFrom, type Agent } from './helpers';

const KAZAN = 424;

describe('премиум-заявка → заказ одной кнопкой', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let supA: string;
  let supB: string;
  let vTop: string;
  let vPants: string;
  let vGown: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function variant(supplierId: string, title: string, price: number) {
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const cat = await prisma.category.findFirstOrThrow();
    const color = await prisma.color.findFirstOrThrow();
    const p = await prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `${title}-${Math.random().toString(36).slice(2, 7)}`, moderationStatus: 'published', publishedAt: new Date(), premium: true,
        variants: { create: { sku: `${title}-M`, size: 'M', colorId: color.id, price, stock: 2, weightG: 500 } },
      },
      include: { variants: true },
    });
    return p.variants[0].id;
  }

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    supA = (await makeSupplier(app, admin, 'a@sup.ru', '7707083893')).supplierId;
    supB = (await makeSupplier(app, admin, 'b@sup.ru', '7736050003')).supplierId;
    await prisma.supplier.updateMany({ data: { payoutStatus: 'active', yookassaAccountId: 'acc' } });
    await prisma.supplier.update({ where: { id: supB }, data: { cdekCityCode: 137, warehouseAddress: 'Санкт-Петербург' } });
    vTop = await variant(supA, 'Топ', 459000);
    vPants = await variant(supA, 'Брюки', 423000);
    vGown = await variant(supB, 'Халат', 389000);
  });

  /** Заявка со снимком капсулы (цены — на момент заявки) */
  async function lead(userId: string | null = null) {
    const item = (slot: string, variantId: string, title: string, price: number) => ({ slot, slotLabel: slot, variantId, productId: '', slug: title, title, brand: 'МедТекс', color: 'Бирюзовый', colorHex: '#000', size: 'M', price, oldPrice: null });
    return prisma.premiumLead.create({
      data: {
        userId, name: 'Анна Смирнова', phone: '+79991234567', contact: 'phone', ip: '10.0.0.1', answers: {},
        capsule: { variantNo: 1, title: 'Капсула', size: 'M', total: 1200000, budget: null, items: [item('Топ', vTop, 'Топ', 450000), item('Брюки', vPants, 'Брюки', 423000), item('Халат', vGown, 'Халат', 389000)] },
      },
    });
  }

  const delivery = () => ({
    [supA]: { type: 'pvz', cityCode: KAZAN, city: 'Казань', pvzCode: '424-PVZ1' },
    [supB]: { type: 'courier', cityCode: KAZAN, city: 'Казань', street: 'ул. Баумана, 5', flat: '12' },
  });
  const body = (email: string, variantIds = [vTop, vPants, vGown]) => ({ recipient: { name: 'Анна Смирнова', phone: '+7 999 123-45-67', email }, delivery: delivery(), variantIds });

  it('гость: черновик с ценами на сейчас → тарифы → заказ; покупатель создан без пароля, письма «оплатить» и «задайте пароль»', async () => {
    const l = await lead();
    const draft = (await admin.get(`/api/admin/premium/${l.id}/order-draft`).expect(200)).body;
    expect(draft.recipient).toEqual({ name: 'Анна Смирнова', phone: '+79991234567', email: '' });
    expect(draft.account).toBeNull();
    const top = draft.items.find((i: { variantId: string }) => i.variantId === vTop);
    expect(top).toMatchObject({ snapshotPrice: 450000, price: 459000, available: true, supplier: { id: supA } });

    const quote = (await admin.post(`/api/admin/premium/${l.id}/quote`).set('Origin', ORIGIN).send({ cityCode: KAZAN, variantIds: [vTop, vPants, vGown] }).expect(200)).body;
    expect(quote.map((q: { supplierId: string }) => q.supplierId).sort()).toEqual([supA, supB].sort());

    const res = await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send(body('anna@example.ru'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ newAccount: true });
    expect(res.body.confirmationUrl).toContain('/pay/test/');

    const order = await prisma.order.findUniqueOrThrow({ where: { number: res.body.number }, include: { shipments: { include: { items: true } }, user: { include: { consents: true } } } });
    expect(order).toMatchObject({ status: 'pending_payment', goodsTotal: 459000 + 423000 + 389000, recipientEmail: 'anna@example.ru', recipientPhone: '+79991234567' });
    expect(order.shipments).toHaveLength(2);
    expect(order.shipments.flatMap((s) => s.items).every((i) => i.fromCapsule)).toBe(true);
    // Срок оплаты — сутки, а не 30 минут оформления
    expect(order.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
    expect(order.user).toMatchObject({ email: 'anna@example.ru', role: 'buyer', emailVerifiedAt: null });
    expect(order.user.consents.map((c) => c.type)).toEqual(['pdn']);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: vTop } })).stock).toBe(1);

    const updated = (await admin.get(`/api/admin/premium/${l.id}`)).body;
    expect(updated).toMatchObject({ status: 'in_progress', order: { number: res.body.number, status: 'pending_payment' } });
    expect(await prisma.auditLog.count({ where: { action: 'premium.lead.order', entityId: l.id } })).toBe(1);

    const pay = mails(app).find((m) => m.to === 'anna@example.ru' && m.subject.includes('ссылка на оплату'))!;
    expect(pay.text).toContain(res.body.confirmationUrl);
    expect(pay.text).toMatch(/Топ, Бирюзовый, M — 4\s590/);
    const setup = mails(app).find((m) => m.to === 'anna@example.ru' && m.subject.startsWith('Ваш аккаунт'))!;
    expect(setup.text).toContain(`заказ № ${res.body.number}`);
    // По ссылке из письма покупатель задаёт пароль и видит заказ
    const buyer = agent(app);
    await buyer.post('/api/auth/reset-password').set('Origin', ORIGIN).send({ token: tokenFrom(setup.text), password: PASSWORD, passwordRepeat: PASSWORD }).expect(200);
    expect((await buyer.get(`/api/orders/${res.body.number}`)).body.status).toBe('pending_payment');

    // Второй заказ по той же заявке — нельзя; повторная ссылка на оплату — можно
    expect((await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send(body('anna@example.ru'))).status).toBe(409);
    const before = mails(app).length;
    await admin.post(`/api/admin/premium/${l.id}/order/resend`).set('Origin', ORIGIN).expect(200);
    expect(mails(app).length).toBe(before + 1);
  });

  it('заявка вошедшего: заказ на его аккаунт, корзина не тронута; можно убрать вещь из состава', async () => {
    await makeUser(app, 'olga@example.ru');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'olga@example.ru' } });
    await prisma.cartItem.create({ data: { userId: user.id, variantId: vGown, qty: 1 } });
    const l = await lead(user.id);
    expect((await admin.get(`/api/admin/premium/${l.id}/order-draft`)).body.recipient.email).toBe('olga@example.ru');
    const res = await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send({ ...body('olga.work@example.ru', [vTop]), delivery: { [supA]: delivery()[supA] } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.newAccount).toBe(false);
    const order = await prisma.order.findUniqueOrThrow({ where: { number: res.body.number }, include: { shipments: true } });
    expect(order).toMatchObject({ userId: user.id, recipientEmail: 'olga.work@example.ru', goodsTotal: 459000 });
    expect(order.shipments).toHaveLength(1);
    expect(await prisma.cartItem.count({ where: { userId: user.id } })).toBe(1);
    expect(mails(app).some((m) => m.subject.startsWith('Ваш аккаунт'))).toBe(false);
  });

  it('проверки: товар закончился — 409 и аккаунт не создаётся; чужой вариант, email сотрудника, доступ', async () => {
    const l = await lead();
    await prisma.productVariant.update({ where: { id: vPants }, data: { stock: 0 } });
    const draft = (await admin.get(`/api/admin/premium/${l.id}/order-draft`)).body;
    expect(draft.items.find((i: { variantId: string }) => i.variantId === vPants).available).toBe(false);
    const gone = await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send(body('new@example.ru'));
    expect(gone.status).toBe(409);
    expect(await prisma.user.count({ where: { email: 'new@example.ru' } })).toBe(0);
    expect((await prisma.premiumLead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('new');

    const other = await variant(supA, 'Чужой', 100000);
    expect((await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send(body('new@example.ru', [vTop, other]))).status).toBe(400);
    expect((await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send(body('a@sup.ru', [vTop]))).status).toBe(409);
    expect((await admin.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send({ ...body('x@example.ru', [vTop]), delivery: {} })).status).toBe(400);

    const moderator = await makeUser(app, 'mod@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'mod@example.ru' }, data: { staffRole: 'moderator' } });
    expect((await moderator.get(`/api/admin/premium/${l.id}/order-draft`)).status).toBe(403);
    expect((await moderator.post(`/api/admin/premium/${l.id}/order`).set('Origin', ORIGIN).send(body('x@example.ru', [vTop]))).status).toBe(403);
  });
});
