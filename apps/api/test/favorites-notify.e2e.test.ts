import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { RestockService } from '../src/favorites/restock.service';
import { OrdersService } from '../src/orders/orders.service';
import { ORIGIN, PASSWORD, agent, bootApp, dictionaries, mails, makeSupplier, makeUser, resetDb, tokenFrom, type Agent } from './helpers';

describe('избранное и «Сообщить о поступлении»', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let sup: Agent;
  let supplierId: string;
  const anon = () => agent(app);
  /** Свой IP на каждый запрос гостя — лимит подписок по IP проверяется отдельно */
  let ipN = 0;
  const guest = () => anon().set('X-Forwarded-For', `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`);

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
    ({ agent: sup, supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
  });

  /** Товар через кабинет поставщика (вариант M в наличии, L — нет), опубликован модерацией */
  async function product(title = 'Костюм «Хирург»') {
    const d = await dictionaries(sup);
    const brand = await sup.post('/api/supplier/brands').set('Origin', ORIGIN).send({ name: `МедТекс ${Math.random().toString(36).slice(2, 6)}` });
    const variant = (sku: string, size: string, stock: number) => ({ sku, size, heightRange: '', colorId: d.colors[0].id, price: 4590, oldPrice: null, stock, weightG: 600, lengthMm: 300, widthMm: 250, heightMm: 50 });
    const body = {
      title, brandId: brand.body.id, categoryId: d.categories[0].id, gender: 'unisex', fabric: '65% ПЭ', treatment: '', washing: '', description: 'Скраб-костюм',
      specialtyIds: [], variants: [variant('K-M', 'M', 3), variant('K-L', 'L', 0)], media: { order: [], mainId: null },
    };
    const res = await sup.post('/api/supplier/products').set('Origin', ORIGIN).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await prisma.product.update({ where: { id: res.body.id }, data: { moderationStatus: 'published', publishedAt: new Date() } });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: res.body.id }, include: { variants: true } });
    const out = p.variants.find((v) => v.size === 'L')!;
    const inStock = p.variants.find((v) => v.size === 'M')!;
    /** Сохранение из кабинета с новыми остатками (id вариантов сохраняются) */
    const saveStock = (m: number, l: number) =>
      sup.put(`/api/supplier/products/${p.id}`).set('Origin', ORIGIN).send({ ...body, variants: [{ ...variant('K-M', 'M', m), id: inStock.id }, { ...variant('K-L', 'L', l), id: out.id }] });
    return { p, out, inStock, saveStock };
  }

  const restockMails = (to: string) => mails(app).filter((m) => m.to === to && m.subject.includes('снова в наличии'));

  it('избранное: гость — карточки по id с «нет в наличии», вошедший — в базе, перенос при входе', async () => {
    const a = await product('Костюм избранный');
    const b = await product('Халат избранный');
    // Товар без остатка исчез с витрины, но в избранном остаётся с пометкой
    await prisma.productVariant.updateMany({ where: { productId: b.p.id }, data: { stock: 0 } });
    const cards = (await anon().get(`/api/catalog/favorites?ids=${a.p.id},${b.p.id},not-a-uuid`)).body.items;
    expect(cards.map((c: any) => [c.title, c.available])).toEqual([['Костюм избранный', true], ['Халат избранный', false]]);

    expect((await anon().get('/api/me/favorites')).status).toBe(401);
    const buyer = await makeUser(app, 'buyer@example.ru');
    await buyer.put(`/api/me/favorites/${a.p.id}`).set('Origin', ORIGIN).expect(200);
    await buyer.put(`/api/me/favorites/${a.p.id}`).set('Origin', ORIGIN).expect(200);
    expect((await buyer.put('/api/me/favorites/00000000-0000-4000-8000-000000000000').set('Origin', ORIGIN)).status).toBe(404);
    // Вход: избранное гостя из браузера переносится, дубли и неизвестные id отбрасываются
    const merged = await buyer.post('/api/me/favorites/merge').set('Origin', ORIGIN).send({ productIds: [b.p.id, a.p.id, '00000000-0000-4000-8000-000000000000'] });
    expect(merged.status).toBe(200);
    expect(merged.body.ids.sort()).toEqual([a.p.id, b.p.id].sort());
    const list = (await buyer.get('/api/me/favorites')).body;
    expect(list.items).toHaveLength(2);
    expect(list.items.find((i: any) => i.id === b.p.id).available).toBe(false);
    await buyer.delete(`/api/me/favorites/${b.p.id}`).set('Origin', ORIGIN).expect(200);
    expect((await buyer.get('/api/me/favorites')).body.ids).toEqual([a.p.id]);
    // Чужое избранное не видно
    const other = await makeUser(app, 'other@example.ru');
    expect((await other.get('/api/me/favorites')).body.ids).toEqual([]);
  });

  it('гость: email и согласие обязательны, в наличии — нельзя; письмо при пополнении из кабинета, подписка закрывается', async () => {
    const { p, out, inStock, saveStock } = await product();
    expect((await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id, consent: true })).status).toBe(400);
    const noConsent = await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id, email: 'guest@example.ru' });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.errors.consent).toBeDefined();
    expect((await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: inStock.id, email: 'guest@example.ru', consent: true })).status).toBe(400);

    const ok = await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id, email: 'Guest@Example.ru', consent: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.email).toBe('g***@example.ru');
    // Повторная подписка — та же строка
    await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id, email: 'guest@example.ru', consent: true }).expect(200);
    expect(await prisma.restockSubscription.count()).toBe(1);
    expect(mails(app).filter((m) => m.to === 'guest@example.ru' && m.text.includes('/restock/unsubscribe?token='))).toHaveLength(2);

    // Обычное сохранение без пополнения — писем нет
    await saveStock(5, 0).expect(200);
    expect(restockMails('guest@example.ru')).toHaveLength(0);
    // Пополнение остатка L из кабинета: 0 → 4
    await saveStock(5, 4).expect(200);
    const sent = restockMails('guest@example.ru');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(`http://localhost:4000/product/${p.slug}`);
    expect(sent[0].text).toContain('размер L');
    expect(sent[0].headers?.['List-Unsubscribe']).toMatch(/\/api\/restock\/unsubscribe\?token=/);
    expect((await prisma.restockSubscription.findFirstOrThrow()).notifiedAt).not.toBeNull();
    // Подписка закрыта: повторное пополнение писем не шлёт
    await saveStock(5, 0).expect(200);
    await saveStock(5, 2).expect(200);
    expect(restockMails('guest@example.ru')).toHaveLength(1);
  });

  it('вошедший — одним кликом; письмо при отмене заказа с возвратом резерва и по проверке всех подписок', async () => {
    const { p, out } = await product();
    const buyer = await makeUser(app, 'buyer@example.ru');
    const ok = await buyer.post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.email).toBe('buyer@example.ru');
    expect((await buyer.get(`/api/me/restock/product/${p.id}`)).body).toEqual([out.id]);
    expect((await buyer.get('/api/me/restock')).body).toEqual([expect.objectContaining({ variantId: out.id, variant: expect.stringContaining('размер L') })]);
    // Вошедшему подтверждение не шлём
    expect(mails(app).filter((m) => m.to === 'buyer@example.ru' && m.subject.includes('Сообщим'))).toHaveLength(0);

    // Неоплаченный заказ держал последнюю штуку L; отмена возвращает резерв → письмо
    await makeUser(app, 'other@example.ru');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'other@example.ru' } });
    const order = await prisma.order.create({
      data: {
        number: '800001', userId: user.id, goodsTotal: 459000, deliveryTotal: 0, total: 459000, recipientName: 'Д', recipientPhone: '+79990000000', recipientEmail: 'other@example.ru', expiresAt: new Date(Date.now() - 1000),
        shipments: {
          create: {
            no: 1, supplierId, deliveryType: 'pvz', tariffCode: 136, cityCode: 44, address: 'Москва', deliveryPrice: 0, periodMin: 1, periodMax: 2, goodsTotal: 459000, commissionBp: 1000, commission: 0,
            items: { create: { variantId: out.id, productSlug: p.slug, title: p.title, brand: 'МедТекс', sku: out.sku, size: 'L', color: 'Белый', price: 459000, qty: 1 } },
          },
        },
      },
    });
    expect(await app.get(OrdersService).cancelUnpaid(order.id, 'Не оплачен вовремя')).toBe(true);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: out.id } })).stock).toBe(1);
    expect(restockMails('buyer@example.ru')).toHaveLength(1);
    expect((await buyer.get('/api/me/restock')).body).toEqual([]);

    // Остаток изменился в обход кабинета (например, SQL поддержки) — подхватит периодическая проверка
    await buyer.post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id }).expect(400);
    await prisma.productVariant.update({ where: { id: out.id }, data: { stock: 0 } });
    await buyer.post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id }).expect(200);
    await prisma.productVariant.update({ where: { id: out.id }, data: { stock: 7 } });
    expect(await app.get(RestockService).run({})).toEqual({ sent: 1 });
    expect(restockMails('buyer@example.ru')).toHaveLength(2);

    // Снятый с продажи товар писем не шлёт, подписка ждёт
    await prisma.productVariant.update({ where: { id: out.id }, data: { stock: 0 } });
    await buyer.post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id }).expect(200);
    await prisma.product.update({ where: { id: p.id }, data: { moderationStatus: 'hidden' } });
    await prisma.productVariant.update({ where: { id: out.id }, data: { stock: 3 } });
    expect(await app.get(RestockService).run({})).toEqual({ sent: 0 });
  });

  it('отписка по ссылке из письма закрывает подписки этого email; неверный токен — 400', async () => {
    const a = await product('Костюм А');
    const b = await product('Костюм Б');
    await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: a.out.id, email: 'guest@example.ru', consent: true }).expect(200);
    await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: b.out.id, email: 'guest@example.ru', consent: true }).expect(200);
    await guest().post('/api/restock').set('Origin', ORIGIN).send({ variantId: b.out.id, email: 'keep@example.ru', consent: true }).expect(200);
    const confirm = mails(app).find((m) => m.to === 'guest@example.ru')!;
    const token = tokenFrom(confirm.text);
    expect((await anon().post('/api/restock/unsubscribe').set('Origin', ORIGIN).send({ token: token.slice(0, -1) + (token.endsWith('0') ? '1' : '0') })).status).toBe(400);
    const res = await anon().post('/api/restock/unsubscribe').set('Origin', ORIGIN).send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelled: 2, email: 'g***@example.ru' });
    // One-click POST почтового клиента: токен в query, без Origin
    await anon().post(`/api/restock/unsubscribe?token=${token}`).expect(200);

    await a.saveStock(3, 2).expect(200);
    await b.saveStock(3, 2).expect(200);
    expect(restockMails('guest@example.ru')).toHaveLength(0);
    expect(restockMails('keep@example.ru')).toHaveLength(1);
  });

  it('лимит подписок гостя по IP', async () => {
    const { out } = await product();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await anon().post('/api/restock').set('X-Forwarded-For', '10.77.0.1').set('Origin', ORIGIN).send({ variantId: out.id, email: `g${i}@example.ru`, consent: true })).status);
    }
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('152-ФЗ: избранное и подписки в выгрузке и удаляются вместе с аккаунтом', async () => {
    const { p, out } = await product();
    const buyer = await makeUser(app, 'buyer@example.ru');
    await buyer.put(`/api/me/favorites/${p.id}`).set('Origin', ORIGIN).expect(200);
    await buyer.post('/api/restock').set('Origin', ORIGIN).send({ variantId: out.id }).expect(200);
    const exported = (await buyer.get('/api/me/export')).body;
    expect(exported.favorites).toEqual([expect.objectContaining({ product: p.title })]);
    expect(exported.restockSubscriptions).toEqual([expect.objectContaining({ product: p.title, email: 'buyer@example.ru' })]);
    await buyer.post('/api/me/delete').set('Origin', ORIGIN).send({ password: PASSWORD }).expect(200);
    expect(await prisma.favorite.count()).toBe(0);
    expect(await prisma.restockSubscription.count()).toBe(0);
  });
});
