import 'reflect-metadata';
import { BadRequestException, Controller, Get, ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/bootstrap';
import { RedisService } from '../src/common/redis.service';
import { config } from '../src/config';
import { ErrorAlertsService, routeOf, scrub } from '../src/monitoring/error-alerts.service';
import { TelegramService } from '../src/notifications/telegram.service';
import { ORIGIN } from './helpers';

@Controller('test-boom')
class BoomController {
  @Get()
  boom() {
    throw new TypeError('сломалось у ivan.petrov@example.ru, телефон +7 (912) 345-67-89, заказ 12345678');
  }

  @Get('cdek')
  cdek() {
    throw new ServiceUnavailableException({ message: 'СДЭК недоступен' });
  }

  @Get('bad')
  bad() {
    throw new BadRequestException({ message: 'Проверьте поля формы' });
  }
}

describe('сообщения об ошибках в Telegram', () => {
  let app: INestApplication;
  let tg: TelegramService;
  let alerts: ErrorAlertsService;
  const chat = config.alertTelegramChatId;

  /** Сообщение уходит без ожидания ответа API — ждём его появления */
  const waitSent = async (n: number) => {
    for (let i = 0; i < 50 && tg.sent.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    return tg.sent;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule], controllers: [BoomController] }).compile();
    app = mod.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
    tg = app.get(TelegramService);
    alerts = app.get(ErrorAlertsService);
    config.alertTelegramChatId = '-100500';
  });
  afterAll(async () => {
    config.alertTelegramChatId = chat;
    await app.close();
  });
  beforeEach(async () => {
    const redis = app.get(RedisService).client;
    const keys = [...(await redis.keys('erra:*')), ...(await redis.keys('rl:client-error:*'))];
    if (keys.length) await redis.del(...keys);
    tg.sent.length = 0;
  });

  it('сбой API: ответ 500 как раньше, одно сообщение без персональных данных, повторы — сводкой', async () => {
    const res = await request(app.getHttpServer()).get('/api/test-boom?email=ivan.petrov@example.ru');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    const [m] = await waitSent(1);
    expect(m.chatId).toBe('-100500');
    expect(m.text).toContain('API');
    expect(m.text).toContain('GET /api/test-boom');
    expect(m.text).toContain('TypeError: сломалось у <почта>, телефон <телефон>, заказ <число>');
    expect(m.text).not.toMatch(/ivan|912|12345678|email=/);

    for (let i = 0; i < 3; i++) await request(app.getHttpServer()).get('/api/test-boom');
    await new Promise((r) => setTimeout(r, 100));
    expect(tg.sent).toHaveLength(1);
    await alerts.digest();
    expect(tg.sent).toHaveLength(2);
    expect(tg.sent[1].text).toContain('ещё 3 ошибок за 10 минут');
    expect(tg.sent[1].text).toContain('3× API: GET /api/test-boom');
    // Сводка отправлена — следующая пустая и не приходит
    await alerts.digest();
    expect(tg.sent).toHaveLength(2);
  });

  it('5xx от внешнего сервиса — сообщение; ошибка клиента (4xx) — нет', async () => {
    expect((await request(app.getHttpServer()).get('/api/test-boom/bad')).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/api/test-boom/cdek')).status).toBe(503);
    const sent = await waitSent(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('ServiceUnavailableException: СДЭК недоступен');
  });

  it('не больше 20 отдельных сообщений в час, остальное — в сводке', async () => {
    for (let i = 0; i < 25; i++) await alerts.report({ source: 'api', where: `GET /api/x${'a'.repeat(i % 26)}`, message: `Ошибка вида ${String.fromCharCode(1072 + i)}` });
    expect(tg.sent).toHaveLength(20);
    expect(tg.sent[19].text).toContain('20-е сообщение за час');
    await alerts.digest();
    expect(tg.sent[20].text).toContain('ещё 5 ошибок');
  });

  it('ошибка рендера сайта: принимается только изнутри, не через Caddy', async () => {
    const body = { route: '/product/[slug]', method: 'GET', kind: 'render', message: 'TypeError: x is undefined' };
    expect((await request(app.getHttpServer()).post('/api/internal/errors').set('X-Forwarded-For', '203.0.113.7').send(body)).status).toBe(404);
    expect(tg.sent).toHaveLength(0);
    expect((await request(app.getHttpServer()).post('/api/internal/errors').send(body)).status).toBe(204);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain('Сайт (сервер)');
    expect(tg.sent[0].text).toContain('GET /product/[slug] (render)');
  });

  it('экран ошибки в браузере: без ссылок, слаг товара схлопнут, не больше 10 за 10 минут с адреса', async () => {
    const send = (message: string) =>
      request(app.getHttpServer()).post('/api/client-errors').set('Origin', ORIGIN).send({ path: '/product/kostyum-klassika-42?utm=1', message, stack: 'at x (app.js:1:1)' });
    expect((await send('Ошибка: перейдите на https://phish.example/login')).status).toBe(204);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain('Сайт (браузер покупателя)');
    expect(tg.sent[0].text).toContain('/product/:slug');
    expect(tg.sent[0].text).toContain('<ссылка>');
    expect(tg.sent[0].text).not.toContain('phish');
    for (let i = 0; i < 9; i++) expect((await send('та же ошибка')).status).toBe(204);
    expect((await send('та же ошибка')).status).toBe(429);
    expect((await request(app.getHttpServer()).post('/api/client-errors').set('Origin', ORIGIN).send({ path: '/', message: 'x'.repeat(3000) })).status).toBe(400);
  });

  it('очистка текста и путей', () => {
    expect(scrub('Пользователь 3f2b1c4d-1111-4222-8333-444455556666 / 8 912 345 67 89 / токен abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe('Пользователь :id / <телефон> / токен <токен>');
    expect(routeOf('/account/orders/MK-2611-0042?tab=1#x')).toBe('/account/orders/:slug');
    expect(routeOf('/catalog/kostyumy')).toBe('/catalog/kostyumy');
    expect(routeOf('/reset-password')).toBe('/reset-password');
    expect(routeOf('/api/internal/x/42')).toBe('/api/internal/x/:slug');
  });
});
