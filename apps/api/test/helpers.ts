import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/bootstrap';
import { MailService } from '../src/common/mail.service';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { SettingsService } from '../src/common/settings.service';

export const ORIGIN = 'http://localhost:4000';
export const PASSWORD = 'correct-horse-1';

export async function bootApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: process.env.TEST_LOG ? ["error"] : false });
  setupApp(app);
  await app.init();
  return app;
}

/** Очистка всех данных кроме справочников; справочники досеиваются. */
export async function resetDb(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.auditLog.deleteMany();
  await prisma.premiumLead.deleteMany();
  await prisma.order.deleteMany();
  await prisma.payoutRegistry.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.promotion.deleteMany();
  // Материалы редакции не привязаны к поставщику и каскадом не удаляются
  await prisma.article.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.platformSetting.deleteMany();
  await prisma.legalVersion.deleteMany();
  app.get(SettingsService).invalidate();
  await prisma.importJob.deleteMany();
  await prisma.productRevision.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplierApplication.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.user.deleteMany();
  await prisma.brand.deleteMany();
  await app.get(RedisService).client.flushdb();
  app.get(MailService).sent.length = 0;
  if ((await prisma.category.count()) === 0) {
    const kost = await prisma.category.create({ data: { name: 'Костюмы', slug: 'kostyumy' } });
    await prisma.category.create({ data: { name: 'Халаты', slug: 'halaty', slot: 'gown' } });
    await prisma.color.createMany({ data: [{ name: 'Бирюзовый', hex: '#2A9D8F', colorFamily: 'teal' }, { name: 'Белый', hex: '#FFFFFF', colorFamily: 'neutral-light' }] });
    const g = await prisma.specialtyGroup.create({ data: { name: 'Хирургия' } });
    await prisma.specialty.create({ data: { name: 'Хирург', slug: 'hirurg', groupId: g.id } });
    void kost;
  }
}

export const agent = (app: INestApplication) => request.agent(app.getHttpServer());
export type Agent = ReturnType<typeof agent>;

export async function makeUser(app: INestApplication, email: string, role: 'buyer' | 'admin' = 'buyer') {
  await app.get(PrismaService).user.create({ data: { email, role, emailVerifiedAt: new Date(), passwordHash: await argon2.hash(PASSWORD) } });
  const a = agent(app);
  const res = await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
  return a;
}

export const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)?.[1] ?? '';
export const mails = (app: INestApplication) => app.get(MailService).sent;

/** Поставщик «под ключ»: заявка → одобрение админом → приглашение → пароль. */
export async function makeSupplier(app: INestApplication, admin: Agent, email: string, inn: string) {
  const anon = agent(app);
  const apply = await anon.post('/api/supplier-applications').set('Origin', ORIGIN).send({
    company: `ООО ${email}`, inn, contactName: 'Ирина', phone: '+7 999 123-45-67', email, assortment: 'скраб-костюмы', acceptPdn: true,
  });
  if (apply.status !== 201) throw new Error(`apply: ${JSON.stringify(apply.body)}`);
  const approve = await admin.post(`/api/admin/applications/${apply.body.id}/approve`).set('Origin', ORIGIN);
  if (approve.status !== 200) throw new Error(`approve: ${JSON.stringify(approve.body)}`);
  const invite = mails(app).filter((m) => m.to === email && m.text.includes('/supplier/invite')).at(-1)!;
  const a = agent(app);
  const acc = await a.post('/api/auth/accept-invite').set('Origin', ORIGIN).send({ token: tokenFrom(invite.text), password: PASSWORD, passwordRepeat: PASSWORD });
  if (acc.status !== 200) throw new Error(`accept: ${JSON.stringify(acc.body)}`);
  await app.get(PrismaService).supplier.update({ where: { id: approve.body.supplierId }, data: { warehouseAddress: 'Москва', cdekCityCode: 44 } });
  return { agent: a, supplierId: approve.body.supplierId as string };
}

export async function jpeg(seed = 0, size = 800) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 40 + seed * 20, g: 150, b: 140 } } }).jpeg().toBuffer();
}

/** Локальный HTTP-сервер для фото и YML-фидов в тестах. */
export async function fileServer(routes: Record<string, () => Promise<{ type: string; body: Buffer | string }>>) {
  const server: Server = createServer(async (req, res) => {
    const route = routes[req.url ?? ''];
    if (!route) {
      res.statusCode = 404;
      return res.end();
    }
    const { type, body } = await route();
    res.setHeader('Content-Type', type);
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function dictionaries(a: Agent) {
  return (await a.get('/api/dictionaries')).body as {
    categories: { id: string; name: string }[];
    colors: { id: string; name: string }[];
    specialtyGroups: { specialties: { id: string; name: string }[] }[];
    brands: { id: string; name: string }[];
  };
}
