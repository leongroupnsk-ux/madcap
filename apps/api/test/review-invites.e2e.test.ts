import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ReviewInvitesService, reviewInviteToken } from '../src/reviews/review-invites.service';
import { ORIGIN, PASSWORD, agent, bootApp, mails, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

const DAY = 86400000;

describe('отзывы: приглашение через 7 дней после доставки и уведомление поставщику', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let invites: ReviewInvitesService;
  let admin: Agent;
  let supplierId: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    invites = app.get(ReviewInvitesService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
  });

  async function product(title: string) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'kostyumy' } });
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const color = await prisma.color.findFirstOrThrow();
    return prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `${title}-${Math.random().toString(36).slice(2, 6)}`, moderationStatus: 'published', publishedAt: new Date(),
        variants: { create: [{ sku: `${title}-M`, size: 'M', colorId: color.id, price: 459000, stock: 5 }] },
      },
      include: { variants: true },
    });
  }

  let orderNo = 700000;
  /** Покупатель с согласием на ПДн (как при регистрации) и заказом, доставленным daysAgo дней назад */
  async function delivered(email: string, daysAgo: number, p: Awaited<ReturnType<typeof product>>) {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await makeUser(app, email);
      user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.consent.create({ data: { userId: user.id, type: 'pdn', version: '1' } });
    }
    const v = p.variants[0];
    const order = await prisma.order.create({
      data: {
        number: String(++orderNo), userId: user.id, status: 'paid', paymentStatus: 'succeeded', goodsTotal: v.price, deliveryTotal: 0, total: v.price,
        recipientName: 'Е', recipientPhone: '+79990000000', recipientEmail: email, expiresAt: new Date(),
        shipments: {
          create: {
            no: 1, supplierId, status: 'delivered', deliveryType: 'pvz', tariffCode: 136, cityCode: 44, address: 'Москва', deliveryPrice: 0, periodMin: 1, periodMax: 2,
            goodsTotal: v.price, commissionBp: 1000, commission: 0, deliveredAt: new Date(Date.now() - daysAgo * DAY),
            items: { create: { variantId: v.id, productSlug: p.slug, title: p.title, brand: 'МедТекс', sku: v.sku, size: v.size, color: 'Белый', price: v.price, qty: 1 } },
          },
        },
      },
      include: { shipments: true },
    });
    return { user, order };
  }

  const invitesTo = (email: string) => mails(app).filter((m) => m.to === email && m.subject.startsWith('Как вам покупка'));

  it('одно письмо на отправление через 7 дней после доставки, со ссылкой на заказ и отпиской', async () => {
    const p = await product('Костюм');
    const { order } = await delivered('buyer@example.ru', 8, p);
    await delivered('fresh@example.ru', 3, p);
    await delivered('old@example.ru', 45, p);
    await prisma.buyerProfile.create({ data: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'buyer@example.ru' } })).id, name: 'Елена Петрова' } });

    expect(await invites.run()).toMatchObject({ sent: 1 });
    const [letter] = invitesTo('buyer@example.ru');
    expect(letter.text).toContain('Здравствуйте, Елена!');
    expect(letter.text).toContain(`/account/orders/${order.number}`);
    expect(letter.text).toContain('• Костюм, M');
    expect(letter.text).toMatch(/review-invites\/unsubscribe\?token=/);
    expect(letter.headers?.['List-Unsubscribe']).toContain('/api/review-invites/unsubscribe?token=');
    expect(invitesTo('fresh@example.ru')).toHaveLength(0);
    expect(invitesTo('old@example.ru')).toHaveLength(0);

    // Повторный запуск — второго письма нет
    await invites.run();
    expect(invitesTo('buyer@example.ru')).toHaveLength(1);
    // Отзыв уже оставлен на все товары — письмо не нужно
    const { user: u2 } = await delivered('reviewed@example.ru', 8, p);
    await prisma.review.create({ data: { productId: p.id, userId: u2.id, authorName: 'Р', rating: 5, fit: 'true_to_size', text: 'Уже написала отзыв' } });
    await invites.run();
    expect(invitesTo('reviewed@example.ru')).toHaveLength(0);
  });

  it('не пишем отписавшимся (ссылка из письма и профиль), удалённым, заблокированным и без согласия на ПДн', async () => {
    const p = await product('Халат');
    const a = await delivered('unsub@example.ru', 8, p);
    const b = await delivered('blocked@example.ru', 8, p);
    const c = await delivered('nopdn@example.ru', 8, p);
    await delivered('profile@example.ru', 8, p);

    // Отписка по ссылке из письма: страница сайта шлёт токен в теле, почтовый клиент — one-click POST без Origin
    const bad = await agent(app).post('/api/review-invites/unsubscribe').set('Origin', ORIGIN).send({ token: `${a.user.id}-${'0'.repeat(32)}` });
    expect(bad.status).toBe(400);
    const ok = await agent(app).post(`/api/review-invites/unsubscribe?token=${reviewInviteToken(a.user.id)}`).expect(200);
    expect(ok.body).toMatchObject({ ok: true, alreadyOff: false, email: 'u***@example.ru' });
    expect((await agent(app).post('/api/review-invites/unsubscribe').set('Origin', ORIGIN).send({ token: reviewInviteToken(a.user.id) })).body.alreadyOff).toBe(true);

    await prisma.user.update({ where: { id: b.user.id }, data: { blockedAt: new Date() } });
    await prisma.consent.updateMany({ where: { userId: c.user.id }, data: { revokedAt: new Date() } });

    // Профиль: выключить и снова включить
    const pa = agent(app);
    await pa.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'profile@example.ru', password: PASSWORD });
    expect((await pa.get('/api/me/review-invites')).body).toEqual({ enabled: true });
    await pa.put('/api/me/review-invites').set('Origin', ORIGIN).send({ enabled: false }).expect(200);
    expect((await pa.get('/api/me/review-invites')).body).toEqual({ enabled: false });
    expect(await prisma.auditLog.count({ where: { action: 'review_invites.off' } })).toBe(2);

    expect(await invites.run()).toMatchObject({ sent: 0, skipped: 4 });
    for (const e of ['unsub@example.ru', 'blocked@example.ru', 'nopdn@example.ru', 'profile@example.ru']) expect(invitesTo(e), e).toHaveLength(0);

    // Включил снова — следующие отправления снова получают приглашение
    await pa.put('/api/me/review-invites').set('Origin', ORIGIN).send({ enabled: true }).expect(200);
    await delivered('profile@example.ru', 9, p);
    await invites.run();
    expect(invitesTo('profile@example.ru')).toHaveLength(1);
  });

  it('поставщику — колокольчик и email о новом опубликованном отзыве (повторное одобрение после правки — без уведомления)', async () => {
    const p = await product('Сабо');
    await delivered('buyer@example.ru', 8, p);
    const buyer = agent(app);
    await buyer.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'buyer@example.ru', password: PASSWORD }).expect(200);
    const r = (await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send({ productId: p.id, rating: 4, fit: 'true_to_size', text: 'Удобные сабо, но жёсткие', photos: [] }).expect(201)).body;
    expect(await prisma.notification.count({ where: { event: 'review' } })).toBe(0);
    await admin.post(`/api/admin/reviews/${r.id}/approve`).set('Origin', ORIGIN).expect(200);

    const n = await prisma.notification.findFirstOrThrow({ where: { event: 'review' } });
    expect(n).toMatchObject({ supplierId, link: `/supplier/products/${p.id}` });
    expect(n.title).toBe('Новый отзыв на «Сабо»: ★★★★☆');
    expect(mails(app).some((m) => m.to === 'owner@sup.ru' && m.subject === n.title && m.text.includes('Удобные сабо'))).toBe(true);

    // Правка → повторная модерация → одобрение: это не новый отзыв
    await buyer.put(`/api/me/reviews/${r.id}`).set('Origin', ORIGIN).send({ rating: 5, fit: 'true_to_size', text: 'Разносились, удобные сабо', photos: [] }).expect(200);
    await admin.post(`/api/admin/reviews/${r.id}/approve`).set('Origin', ORIGIN).expect(200);
    expect(await prisma.notification.count({ where: { event: 'review' } })).toBe(1);

    // Поставщик выключил событие — в колокольчике есть, письма нет
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@sup.ru' } });
    await prisma.notificationSetting.create({ data: { userId: owner.id, supplierId, mutedEvents: ['review'] } });
    const p2 = await product('Шапочка');
    await delivered('buyer@example.ru', 8, p2);
    const r2 = (await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send({ productId: p2.id, rating: 5, fit: 'true_to_size', text: 'Отличная шапочка, сидит', photos: [] }).expect(201)).body;
    const before = mails(app).filter((m) => m.to === 'owner@sup.ru').length;
    await admin.post(`/api/admin/reviews/${r2.id}/approve`).set('Origin', ORIGIN).expect(200);
    expect(await prisma.notification.count({ where: { event: 'review' } })).toBe(2);
    expect(mails(app).filter((m) => m.to === 'owner@sup.ru').length).toBe(before);
  });
});
