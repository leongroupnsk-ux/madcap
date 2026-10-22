import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totpCode } from '../src/auth/totp';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, PASSWORD, agent, bootApp, dictionaries, jpeg, mails, makeSupplier, makeUser, resetDb, tokenFrom, type Agent } from './helpers';

describe('поставщики, товары, модерация', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
  });
  afterAll(async () => {
    await app.close();
  });

  async function newProduct(a: Agent, overrides: Record<string, unknown> = {}) {
    const d = await dictionaries(a);
    const brand = await a.post('/api/supplier/brands').set('Origin', ORIGIN).send({ name: `МедТекс ${Math.random().toString(36).slice(2, 6)}` });
    const body = {
      title: 'Костюм «Хирург»', brandId: brand.body.id, categoryId: d.categories[0].id, gender: 'unisex', fabric: '65% ПЭ',
      treatment: '', washing: '', description: 'Классический скраб-костюм', specialtyIds: [d.specialtyGroups[0].specialties[0].id],
      variants: [{ sku: 'MT-1-M', size: 'M', heightRange: '170–176', colorId: d.colors[0].id, price: 4590, oldPrice: 5290, stock: 12, weightG: 600, lengthMm: 300, widthMm: 250, heightMm: 50 }],
      media: { order: [], mainId: null },
      ...overrides,
    };
    const res = await a.post('/api/supplier/products').set('Origin', ORIGIN).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { product: res.body, body };
  }

  const upload = async (a: Agent, id: string, seed: number) => {
    const res = await a.post(`/api/supplier/products/${id}/media`).set('Origin', ORIGIN).attach('file', await jpeg(seed), { filename: `p${seed}.jpg`, contentType: 'image/jpeg' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };

  it('заявка: проверка ИНН, одобрение, приглашение, вход в кабинет', async () => {
    const anon = agent(app);
    const bad = await anon.post('/api/supplier-applications').set('Origin', ORIGIN).send({ company: 'ООО Тест', inn: '7707083894', contactName: 'Ирина', phone: '+79991234567', email: 'a@b.ru', assortment: 'топы', acceptPdn: true });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.inn).toMatch(/ИНН/);

    const { agent: sup, supplierId } = await makeSupplier(app, admin, 'owner@medteks.ru', '7707083893');
    const me = await sup.get('/api/supplier/me');
    expect(me.body).toMatchObject({ role: 'owner', supplier: { id: supplierId, inn: '7707083893', status: 'active' } });

    const again = await agent(app).post('/api/supplier-applications').set('Origin', ORIGIN).send({ company: 'ООО Дубль', inn: '7707083893', contactName: 'Ирина', phone: '+79991234567', email: 'x@b.ru', assortment: 'топы', acceptPdn: true });
    expect((await admin.post(`/api/admin/applications/${again.body.id}/approve`).set('Origin', ORIGIN)).status).toBe(409);
  });

  it('доступы: покупатель не видит кабинет и админку, поставщики изолированы', async () => {
    const buyer = await makeUser(app, 'buyer@example.ru');
    expect((await buyer.get('/api/supplier/me')).status).toBe(403);
    expect((await buyer.get('/api/admin/moderation')).status).toBe(403);
    expect((await agent(app).get('/api/admin/moderation')).status).toBe(401);

    const a = await makeSupplier(app, admin, 'a@sup.ru', '7707083893');
    const b = await makeSupplier(app, admin, 'b@sup.ru', '500100732259');
    const { product } = await newProduct(a.agent);
    expect((await b.agent.get(`/api/supplier/products/${product.id}`)).status).toBe(404);
    expect((await b.agent.put(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN).send({})).status).toBe(400);
    expect((await b.agent.get('/api/supplier/products')).body.total).toBe(0);
  });

  it('сотрудник «склад» не правит каталог; владелец приглашает и удаляет сотрудников', async () => {
    const owner = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const invited = await owner.agent.post('/api/supplier/members').set('Origin', ORIGIN).send({ email: 'wh@sup.ru', role: 'warehouse' });
    expect(invited.body).toHaveLength(2);
    const link = mails(app).filter((m) => m.to === 'wh@sup.ru').at(-1)!;
    const wh = agent(app);
    await wh.post('/api/auth/accept-invite').set('Origin', ORIGIN).send({ token: tokenFrom(link.text), password: PASSWORD, passwordRepeat: PASSWORD });
    expect((await wh.get('/api/supplier/me')).body.role).toBe('warehouse');
    expect((await wh.get('/api/supplier/products')).status).toBe(403);
    expect((await wh.get('/api/supplier/members')).status).toBe(403);
    const whId = invited.body.find((m: { email: string }) => m.email === 'wh@sup.ru').userId;
    expect((await owner.agent.delete(`/api/supplier/members/${whId}`).set('Origin', ORIGIN)).body).toHaveLength(1);
    expect((await wh.get('/api/supplier/me')).status).toBe(403);
  });

  it('товар: черновик → проверка требований → модерация → публикация', async () => {
    const { agent: sup } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const { product } = await newProduct(sup);
    expect(product.moderationStatus).toBe('draft');
    expect(product.variants[0].price).toBe(4590);

    const early = await sup.post(`/api/supplier/products/${product.id}/submit`).set('Origin', ORIGIN);
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/минимум 3 фото/);

    for (const seed of [1, 2, 3]) await upload(sup, product.id, seed);
    const withMedia = (await sup.get(`/api/supplier/products/${product.id}`)).body;
    expect(withMedia.media).toHaveLength(3);
    expect(withMedia.media[0].isMain).toBe(true);
    const file = await agent(app).get(withMedia.media[0].url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');

    expect((await sup.post(`/api/supplier/products/${product.id}/submit`).set('Origin', ORIGIN)).body.moderationStatus).toBe('pending');
    const queue = (await admin.get('/api/admin/moderation')).body;
    expect(queue).toMatchObject([{ kind: 'product', productId: product.id }]);
    expect((await admin.post(`/api/admin/moderation/products/${product.id}/approve`).set('Origin', ORIGIN)).status).toBe(204);
    const live = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { media: true } });
    expect(live.moderationStatus).toBe('published');
    expect(live.media.every((m) => m.approved)).toBe(true);
    expect(mails(app).some((m) => m.subject.includes('опубликован'))).toBe(true);
  });

  it('опубликованный товар: цена сразу, текст и фото — через ревизию; отклонение удаляет новые фото', async () => {
    const { agent: sup } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const { product, body } = await newProduct(sup);
    for (const seed of [1, 2, 3]) await upload(sup, product.id, seed);
    await sup.post(`/api/supplier/products/${product.id}/submit`).set('Origin', ORIGIN);
    await admin.post(`/api/admin/moderation/products/${product.id}/approve`).set('Origin', ORIGIN);

    const current = (await sup.get(`/api/supplier/products/${product.id}`)).body;
    const variants = current.variants.map((v: Record<string, unknown>) => ({ ...v, price: 3990, stock: 5 }));
    const save = await sup.put(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN).send({ ...body, title: 'Костюм «Хирург Про»', variants, media: { order: current.media.map((m: { id: string }) => m.id), mainId: current.media[0].id } });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(save.body.title).toBe('Костюм «Хирург Про»');
    expect(save.body.revision.status).toBe('pending');

    let live = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
    expect(live.title).toBe('Костюм «Хирург»');
    expect(live.variants[0].price).toBe(399000);
    expect(live.variants[0].stock).toBe(5);

    const rev = (await admin.get('/api/admin/moderation')).body[0];
    expect(rev.kind).toBe('revision');
    const details = (await admin.get(`/api/admin/moderation/products/${product.id}`)).body;
    expect(details.live.title).toBe('Костюм «Хирург»');
    expect(details.revision.title).toBe('Костюм «Хирург Про»');
    await admin.post(`/api/admin/moderation/revisions/${rev.id}/approve`).set('Origin', ORIGIN);
    live = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
    expect(live.title).toBe('Костюм «Хирург Про»');

    // Новое фото + правка → отклонение: фото удаляется, на витрине прежняя версия.
    const withPhoto = await upload(sup, product.id, 7);
    const newMedia = withPhoto.media.find((m: { approved: boolean }) => !m.approved);
    await sup.put(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN).send({ ...body, title: 'Костюм «Хирург Про»', variants: withPhoto.variants, media: { order: withPhoto.media.map((m: { id: string }) => m.id), mainId: newMedia.id } });
    const rev2 = (await admin.get('/api/admin/moderation')).body[0];
    await admin.post(`/api/admin/moderation/revisions/${rev2.id}/reject`).set('Origin', ORIGIN).send({ reason: 'Фото с водяным знаком' });
    expect(await prisma.productMedia.count({ where: { productId: product.id } })).toBe(3);
    const after = (await sup.get(`/api/supplier/products/${product.id}`)).body;
    expect(after.revision).toMatchObject({ status: 'rejected', rejectReason: 'Фото с водяным знаком' });
  });

  it('снятие с витрины, удаление только для никогда не публиковавшихся', async () => {
    const { agent: sup } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const { product } = await newProduct(sup);
    for (const seed of [1, 2, 3]) await upload(sup, product.id, seed);
    await sup.post(`/api/supplier/products/${product.id}/submit`).set('Origin', ORIGIN);
    await admin.post(`/api/admin/moderation/products/${product.id}/approve`).set('Origin', ORIGIN);
    expect((await sup.post(`/api/supplier/products/${product.id}/hide`).set('Origin', ORIGIN)).body.moderationStatus).toBe('hidden');
    expect((await sup.delete(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN)).status).toBe(400);
    const { product: draft } = await newProduct(sup, { variants: [] });
    expect((await sup.delete(`/api/supplier/products/${draft.id}`).set('Origin', ORIGIN)).status).toBe(204);
  });

  it('валидация: неизвестный цвет, повтор SKU, старая цена ниже текущей', async () => {
    const { agent: sup } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const { product, body } = await newProduct(sup);
    const v = body.variants[0];
    const dup = await sup.put(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN).send({ ...body, variants: [v, { ...v }] });
    expect(dup.status).toBe(400);
    const badPrice = await sup.put(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN).send({ ...body, variants: [{ ...v, oldPrice: 100 }] });
    expect(badPrice.status).toBe(400);
    expect(badPrice.body.errors['variants.0.oldPrice']).toBeTruthy();
    const badColor = await sup.put(`/api/supplier/products/${product.id}`).set('Origin', ORIGIN).send({ ...body, variants: [{ ...v, colorId: '00000000-0000-4000-8000-000000000000' }] });
    expect(badColor.status).toBe(400);
  });

  it('видео: mp4 до 60 с принимается, постер делается; длинное — отклоняется', async () => {
    const { agent: sup } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const { product } = await newProduct(sup);
    const mk = (sec: number) => {
      const out = join(tmpdir(), `t${sec}.mp4`);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=teal:s=320x240:d=${sec}`, '-pix_fmt', 'yuv420p', '-y', out]);
      return readFileSync(out);
    };
    const ok = await sup.post(`/api/supplier/products/${product.id}/media`).set('Origin', ORIGIN).attach('file', mk(2), { filename: 'v.mp4', contentType: 'video/mp4' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const video = ok.body.media.find((m: { type: string }) => m.type === 'video');
    expect(video.posterUrl).toMatch(/_poster\.webp$/);
    expect((await agent(app).get(video.posterUrl)).status).toBe(200);
    const long = await sup.post(`/api/supplier/products/${product.id}/media`).set('Origin', ORIGIN).attach('file', mk(62), { filename: 'long.mp4', contentType: 'video/mp4' });
    expect(long.status).toBe(400);
    expect(long.body.message).toMatch(/60 секунд/);
  });

  it('2FA: включение кодом, вход требует код', async () => {
    const { agent: sup } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    const setup = (await sup.post('/api/auth/totp/setup').set('Origin', ORIGIN)).body;
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect((await sup.post('/api/auth/totp/enable').set('Origin', ORIGIN).send({ code: '000000' })).status).toBe(400);
    expect((await sup.post('/api/auth/totp/enable').set('Origin', ORIGIN).send({ code: totpCode(setup.secret) })).body.user.totpEnabled).toBe(true);

    const a = agent(app);
    const first = await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'owner@sup.ru', password: PASSWORD });
    expect(first.status).toBe(401);
    expect(first.body.code).toBe('totp_required');
    const ok = await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'owner@sup.ru', password: PASSWORD, totp: totpCode(setup.secret) });
    expect(ok.status).toBe(200);
  });
});
