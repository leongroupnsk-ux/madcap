import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/bootstrap';
import { MailService } from '../src/common/mail.service';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const ORIGIN = 'http://localhost:4000';
const PASSWORD = 'correct-horse-1';

describe('auth', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await app.get(RedisService).client.flushdb();
    mail.sent.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const agent = () => request.agent(app.getHttpServer());
  const register = (a: ReturnType<typeof agent>, email = 'elena@example.ru') =>
    a.post('/api/auth/register').set('Origin', ORIGIN).send({ email, password: PASSWORD, passwordRepeat: PASSWORD, acceptTerms: true });
  const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)?.[1] ?? '';

  it('регистрирует, ставит сессию и сохраняет согласия', async () => {
    const a = agent();
    const res = await register(a, 'Elena@Example.ru');
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'elena@example.ru', role: 'buyer', emailVerified: false });
    expect(res.headers['set-cookie']?.[0]).toMatch(/sid=.+HttpOnly/);
    expect((await a.get('/api/auth/me')).body.user.email).toBe('elena@example.ru');
    const consents = await prisma.consent.findMany();
    expect(consents.map((c) => c.type).sort()).toEqual(['offer', 'pdn']);
  });

  it('отклоняет невалидную форму с ошибками по полям', async () => {
    const res = await agent()
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .send({ email: 'bad', password: '123', passwordRepeat: '456', acceptTerms: false });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors).sort()).toEqual(['acceptTerms', 'email', 'password']);
  });

  it('не даёт зарегистрировать email дважды', async () => {
    await register(agent());
    expect((await register(agent())).status).toBe(409);
  });

  it('подтверждает email по ссылке из письма, ссылка одноразовая', async () => {
    const a = agent();
    await register(a);
    const token = tokenFrom(mail.sent[0].text);
    expect((await a.post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token })).status).toBe(204);
    expect((await a.get('/api/auth/me')).body.user.emailVerified).toBe(true);
    expect((await a.post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token })).status).toBe(400);
  });

  it('входит, выходит; неверный пароль — общий ответ 401', async () => {
    await register(agent());
    const a = agent();
    const bad = await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'elena@example.ru', password: 'nope' });
    expect(bad.status).toBe(401);
    const ghost = await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'ghost@example.ru', password: 'nope' });
    expect(ghost.body.message).toBe(bad.body.message);
    expect((await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'elena@example.ru', password: PASSWORD })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await a.post('/api/auth/logout').set('Origin', ORIGIN)).status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('ограничивает перебор пароля: 6-я попытка за 15 минут — 429', async () => {
    await register(agent());
    const a = agent();
    for (let i = 0; i < 5; i++) {
      expect((await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'elena@example.ru', password: 'x' })).status).toBe(401);
    }
    expect((await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'elena@example.ru', password: PASSWORD })).status).toBe(429);
  });

  it('сброс пароля: одинаковый ответ для любого email, новый пароль, старые сессии закрыты', async () => {
    const owner = agent();
    await register(owner);
    mail.sent.length = 0;

    const a = agent();
    expect((await a.post('/api/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'ghost@example.ru' })).status).toBe(204);
    expect(mail.sent).toHaveLength(0);
    expect((await a.post('/api/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'elena@example.ru' })).status).toBe(204);
    const token = tokenFrom(mail.sent[0].text);

    const reset = await a.post('/api/auth/reset-password').set('Origin', ORIGIN).send({ token, password: 'new-pass-123', passwordRepeat: 'new-pass-123' });
    expect(reset.status).toBe(200);
    expect((await owner.get('/api/auth/me')).status).toBe(401);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    const old = await agent().post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'elena@example.ru', password: PASSWORD });
    expect(old.status).toBe(401);
  });

  it('отклоняет изменяющие запросы с чужого origin', async () => {
    const res = await agent().post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'a@b.ru', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('healthz отвечает ok', async () => {
    expect((await agent().get('/api/healthz')).body).toEqual({ ok: true });
  });
});
