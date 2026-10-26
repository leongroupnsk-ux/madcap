import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { StorageService } from '../src/common/storage.service';
import { ORIGIN, PASSWORD, agent, bootApp, jpeg, mails, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('отзывы: право на отзыв, модерация, витрина, ответ продавца', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let sup: Agent;
  let supplierId: string;
  let buyer: Agent;
  const anon = () => agent(app);

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
    buyer = await makeUser(app, 'buyer@example.ru');
    await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ name: 'Елена Петрова' }).expect(200);
  });

  /** Опубликованный товар в наличии */
  async function product(title: string, owner = supplierId) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'kostyumy' } });
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const color = await prisma.color.findFirstOrThrow();
    return prisma.product.create({
      data: {
        supplierId: owner, brandId: brand.id, categoryId: cat.id, title, slug: `${title.replace(/\W+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`,
        gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(),
        variants: { create: [{ sku: `${title}-M`, size: 'M', colorId: color.id, price: 459000, stock: 5 }] },
      },
      include: { variants: true },
    });
  }

  let orderNo = 900000;
  /** Заказ покупателя с одной позицией товара в отправлении с заданным статусом */
  async function order(email: string, p: Awaited<ReturnType<typeof product>>, status: 'delivered' | 'in_transit' = 'delivered', returnedQty = 0) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const v = p.variants[0];
    return prisma.order.create({
      data: {
        number: String(++orderNo), userId: user.id, status: 'paid', paymentStatus: 'succeeded', goodsTotal: v.price, deliveryTotal: 0, total: v.price,
        recipientName: 'Е', recipientPhone: '+79990000000', recipientEmail: email, expiresAt: new Date(),
        shipments: {
          create: {
            no: 1, supplierId: p.supplierId, status, deliveryType: 'pvz', tariffCode: 136, cityCode: 44, address: 'Москва', deliveryPrice: 0, periodMin: 1, periodMax: 2,
            goodsTotal: v.price, commissionBp: 1000, commission: 0, deliveredAt: status === 'delivered' ? new Date() : null,
            items: { create: { variantId: v.id, productSlug: p.slug, title: p.title, brand: 'МедТекс', sku: v.sku, size: v.size, color: 'Белый', price: v.price, qty: 1, returnedQty } },
          },
        },
      },
    });
  }

  const review = (productId: string, extra: Record<string, unknown> = {}) => ({ productId, rating: 5, fit: 'true_to_size', text: 'Отличный костюм, ткань плотная.', photos: [], ...extra });

  it('оставить отзыв можно только после доставки, один на товар; чужой отзыв не отредактировать', async () => {
    const p = await product('Костюм отзыв');
    // Нет заказа, заказ в пути, доставлен и возвращён целиком — нельзя
    expect((await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id))).status).toBe(403);
    await order('buyer@example.ru', p, 'in_transit');
    expect((await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id))).status).toBe(403);
    await order('buyer@example.ru', p, 'delivered', 1);
    const returned = await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id));
    expect(returned.status).toBe(403);
    expect(returned.body.message).toMatch(/после получения/);
    expect((await buyer.get('/api/me/reviews')).body.eligible).toHaveLength(0);

    await order('buyer@example.ru', p);
    const mine = (await buyer.get('/api/me/reviews')).body;
    expect(mine.eligible.map((e: any) => e.id)).toEqual([p.id]);
    expect((await buyer.get(`/api/me/reviews/product/${p.id}`)).body).toMatchObject({ canReview: true, review: null });

    // Валидация: оценка 1–5, текст от 10 символов
    expect((await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { rating: 6 }))).status).toBe(400);
    expect((await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { text: 'коротко' }))).status).toBe(400);

    const created = await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: 'pending', rating: 5, fit: 'true_to_size' });
    expect((await prisma.review.findUniqueOrThrow({ where: { id: created.body.id } })).authorName).toBe('Елена');
    expect((await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id))).status).toBe(409);
    expect((await anon().post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id))).status).toBe(401);

    // Чужой отзыв: ни правки, ни удаления
    const other = await makeUser(app, 'other@example.ru');
    expect((await other.put(`/api/me/reviews/${created.body.id}`).set('Origin', ORIGIN).send(review(p.id, { text: 'Подмена текста отзыва' }))).status).toBe(404);
    expect((await other.delete(`/api/me/reviews/${created.body.id}`).set('Origin', ORIGIN)).status).toBe(404);
    expect((await prisma.review.findUniqueOrThrow({ where: { id: created.body.id } })).text).toBe('Отличный костюм, ткань плотная.');
  });

  it('модерация: очередь только для модерации, одобрение и отказ с причиной, аудит, статус в профиле', async () => {
    const p = await product('Костюм модерация');
    await order('buyer@example.ru', p);
    const r = (await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id))).body;

    // До модерации на витрине отзыва нет
    expect((await anon().get(`/api/catalog/products/${p.slug}/reviews`)).body.summary.count).toBe(0);
    expect((await buyer.get('/api/admin/reviews')).status).toBe(403);
    expect((await sup.get('/api/admin/reviews')).status).toBe(403);
    const queue = (await admin.get('/api/admin/reviews')).body;
    expect(queue.items.map((i: any) => i.id)).toEqual([r.id]);
    expect(queue.counts.pending).toBe(1);

    expect((await admin.post(`/api/admin/reviews/${r.id}/reject`).set('Origin', ORIGIN).send({ reason: '' })).status).toBe(400);
    await admin.post(`/api/admin/reviews/${r.id}/reject`).set('Origin', ORIGIN).send({ reason: 'Есть ссылка на другой магазин' }).expect(200);
    expect(mails(app).some((m) => m.to === 'buyer@example.ru' && m.text.includes('Есть ссылка на другой магазин'))).toBe(true);
    let mine = (await buyer.get('/api/me/reviews')).body.reviews[0];
    expect(mine).toMatchObject({ status: 'rejected', rejectReason: 'Есть ссылка на другой магазин' });

    // Исправленный отзыв — снова в очередь
    await buyer.put(`/api/me/reviews/${r.id}`).set('Origin', ORIGIN).send(review(p.id, { text: 'Исправленный текст отзыва без ссылок', rating: 4 })).expect(200);
    mine = (await buyer.get('/api/me/reviews')).body.reviews[0];
    expect(mine).toMatchObject({ status: 'pending', rejectReason: null });

    await admin.post(`/api/admin/reviews/${r.id}/approve`).set('Origin', ORIGIN).expect(200);
    // Повторное одобрение того же — конфликт
    expect((await admin.post(`/api/admin/reviews/${r.id}/approve`).set('Origin', ORIGIN)).status).toBe(409);
    const list = (await anon().get(`/api/catalog/products/${p.slug}/reviews`)).body;
    expect(list.summary).toMatchObject({ count: 1, avg: 4 });
    expect(list.items[0]).toMatchObject({ author: 'Елена', rating: 4, text: 'Исправленный текст отзыва без ссылок', reply: null });
    expect(JSON.stringify(list)).not.toMatch(/buyer@example\.ru|userId/);
    expect((await buyer.get('/api/me/reviews')).body.reviews[0].status).toBe('approved');
    expect(await prisma.auditLog.count({ where: { action: { in: ['moderation.review.approve', 'moderation.review.reject'] } } })).toBe(2);

    // Правка опубликованного снимает его с витрины до повторной модерации
    await buyer.put(`/api/me/reviews/${r.id}`).set('Origin', ORIGIN).send(review(p.id, { text: 'Через месяц: всё ещё отличный' })).expect(200);
    expect((await anon().get(`/api/catalog/products/${p.slug}/reviews`)).body.summary.count).toBe(0);
  });

  it('агрегаты: средняя, распределение, посадка, карточка каталога, JSON для разметки; кэш сбрасывается одобрением', async () => {
    process.env.CATALOG_CACHE = 'on';
    try {
      const p = await product('Костюм агрегаты');
      const ratings = [5, 3, 4];
      const fits = ['true_to_size', 'small', 'true_to_size'];
      const ids: string[] = [];
      for (const [i, rating] of ratings.entries()) {
        const email = `b${i}@example.ru`;
        const a = await makeUser(app, email);
        await order(email, p);
        ids.push((await a.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { rating, fit: fits[i] }))).body.id);
      }
      await admin.post(`/api/admin/reviews/${ids[0]}/approve`).set('Origin', ORIGIN).expect(200);
      let details = (await anon().get(`/api/catalog/products/${p.slug}`)).body;
      expect(details.reviews).toMatchObject({ count: 1, avg: 5, fitMost: 'true_to_size' });

      // Изменение в обход модерации не видно — сводка из кэша; одобрение следующего сбрасывает кэш
      await prisma.review.update({ where: { id: ids[0] }, data: { rating: 1 } });
      expect((await anon().get(`/api/catalog/products/${p.slug}`)).body.reviews.avg).toBe(5);
      await prisma.review.update({ where: { id: ids[0] }, data: { rating: 5 } });
      await admin.post(`/api/admin/reviews/${ids[1]}/approve`).set('Origin', ORIGIN).expect(200);
      await admin.post(`/api/admin/reviews/${ids[2]}/approve`).set('Origin', ORIGIN).expect(200);
      details = (await anon().get(`/api/catalog/products/${p.slug}`)).body;
      expect(details.reviews).toMatchObject({ count: 3, avg: 4, fit: { small: 1, true_to_size: 2, large: 0 }, fitMost: 'true_to_size' });
      expect(details.reviews.distribution).toEqual([
        { stars: 5, count: 1 }, { stars: 4, count: 1 }, { stars: 3, count: 1 }, { stars: 2, count: 0 }, { stars: 1, count: 0 },
      ]);
      expect(details.reviews.latest).toHaveLength(3);

      // Карточка в каталоге — оценка и число отзывов; у товара без отзывов — null
      const other = await product('Халат без отзывов');
      const cards = (await anon().get('/api/catalog/products')).body.items;
      expect(cards.find((c: any) => c.id === p.id).rating).toEqual({ avg: 4, count: 3 });
      expect(cards.find((c: any) => c.id === other.id).rating).toBeNull();

      // Отклонение опубликованного тоже сбрасывает кэш
      await admin.post(`/api/admin/reviews/${ids[1]}/reject`).set('Origin', ORIGIN).send({ reason: 'Нарушает правила' }).expect(200);
      expect((await anon().get(`/api/catalog/products/${p.slug}`)).body.reviews).toMatchObject({ count: 2, avg: 4.5 });

      // Пагинация списка: по 10
      const list = (await anon().get(`/api/catalog/products/${p.slug}/reviews?page=5`)).body;
      expect(list).toMatchObject({ page: 1, pages: 1 });
      expect(list.items).toHaveLength(2);
    } finally {
      process.env.CATALOG_CACHE = 'off';
    }
  });

  it('фото: до 3, EXIF вырезан, чужое фото не прикрепить', async () => {
    const p = await product('Костюм фото');
    await order('buyer@example.ru', p);
    const withExif = await sharp(await jpeg(2)).withExif({ IFD0: { Artist: 'Елена Петрова', Copyright: 'GPS 55.75,37.61' } }).jpeg().toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const up = await buyer.post('/api/me/reviews/photos').set('Origin', ORIGIN).attach('file', withExif, { filename: 'me.jpg', contentType: 'image/jpeg' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.key).toMatch(/^public\/reviews\/[0-9a-f-]{36}\.webp$/);
    const file = app.get(StorageService).localPath(up.body.key);
    const meta = await sharp(file).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('webp');
    expect((await buyer.post('/api/me/reviews/photos').set('Origin', ORIGIN).attach('file', Buffer.from('not an image'), { filename: 'x.jpg', contentType: 'image/jpeg' })).status).toBe(400);

    // Фото другого покупателя прикрепить нельзя
    const other = await makeUser(app, 'other@example.ru');
    await order('other@example.ru', p);
    expect((await other.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { photos: [up.body.key] }))).status).toBe(400);
    // Больше трёх — нельзя
    expect((await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { photos: [up.body.key, 'a', 'b', 'c'] }))).status).toBe(400);

    const r = await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { photos: [up.body.key] }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await admin.post(`/api/admin/reviews/${r.body.id}/approve`).set('Origin', ORIGIN).expect(200);
    const item = (await anon().get(`/api/catalog/products/${p.slug}/reviews`)).body.items[0];
    expect(item.photos[0].url).toMatch(/^\/api\/files\/reviews\//);
    expect(item.photos[0].image.srcSet).toMatch(/320w/);

    // Удалённое из отзыва фото удаляется из хранилища
    await buyer.put(`/api/me/reviews/${r.body.id}`).set('Origin', ORIGIN).send(review(p.id, { photos: [] })).expect(200);
    expect(existsSync(file)).toBe(false);
  });

  it('поставщик: видит одобренные отзывы на свои товары и отвечает один раз; ответ виден на витрине', async () => {
    const p = await product('Костюм ответ');
    await order('buyer@example.ru', p);
    const r = (await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id))).body;
    // Неодобренный не виден и на него не ответить
    expect((await sup.get(`/api/supplier/products/${p.id}/reviews`)).body.count).toBe(0);
    expect((await sup.post(`/api/supplier/products/${p.id}/reviews/${r.id}/reply`).set('Origin', ORIGIN).send({ text: 'Спасибо!' })).status).toBe(404);
    await admin.post(`/api/admin/reviews/${r.id}/approve`).set('Origin', ORIGIN).expect(200);

    const list = (await sup.get(`/api/supplier/products/${p.id}/reviews`)).body;
    expect(list).toMatchObject({ count: 1, avg: 5 });
    await sup.post(`/api/supplier/products/${p.id}/reviews/${r.id}/reply`).set('Origin', ORIGIN).send({ text: 'Спасибо за отзыв!' }).expect(200);
    expect((await sup.post(`/api/supplier/products/${p.id}/reviews/${r.id}/reply`).set('Origin', ORIGIN).send({ text: 'Ещё раз спасибо' })).status).toBe(409);
    const item = (await anon().get(`/api/catalog/products/${p.slug}/reviews`)).body.items[0];
    expect(item.reply).toMatchObject({ text: 'Спасибо за отзыв!', seller: 'ООО owner@sup.ru' });

    // Чужой поставщик — ни списка, ни ответа
    const { agent: sup2 } = await makeSupplier(app, admin, 'owner@other.ru', '7728168971');
    expect((await sup2.get(`/api/supplier/products/${p.id}/reviews`)).status).toBe(404);
    expect((await sup2.post(`/api/supplier/products/${p.id}/reviews/${r.id}/reply`).set('Origin', ORIGIN).send({ text: 'Чужой ответ' })).status).toBe(404);
  });

  it('152-ФЗ: отзыв в выгрузке; при удалении аккаунта обезличивается, текст остаётся', async () => {
    const p = await product('Костюм ПДн');
    await order('buyer@example.ru', p);
    const up = await buyer.post('/api/me/reviews/photos').set('Origin', ORIGIN).attach('file', await jpeg(3), { filename: 'me.jpg', contentType: 'image/jpeg' });
    const r = (await buyer.post('/api/me/reviews').set('Origin', ORIGIN).send(review(p.id, { photos: [up.body.key] }))).body;
    await admin.post(`/api/admin/reviews/${r.id}/approve`).set('Origin', ORIGIN).expect(200);
    const exported = (await buyer.get('/api/me/export')).body;
    expect(exported.reviews).toEqual([expect.objectContaining({ product: 'Костюм ПДн', rating: 5, text: 'Отличный костюм, ткань плотная.', status: 'approved', photos: 1 })]);

    await buyer.post('/api/me/delete').set('Origin', ORIGIN).send({ password: PASSWORD }).expect(200);
    const after = await prisma.review.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ authorName: 'Покупатель', text: 'Отличный костюм, ткань плотная.', photos: [] });
    expect(existsSync(app.get(StorageService).localPath(up.body.key))).toBe(false);
    expect((await anon().get(`/api/catalog/products/${p.slug}/reviews`)).body.items[0].author).toBe('Покупатель');
  });
});
