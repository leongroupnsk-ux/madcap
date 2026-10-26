import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { RedisService } from '../src/common/redis.service';
import { config } from '../src/config';
import { ORIGIN, PASSWORD, agent, bootApp, makeUser, resetDb } from './helpers';

/**
 * Интеграции, для которых пока нет ключей: SmartCaptcha (E6-06), подсказки адреса DaData (E4-10),
 * конфиг карты ПВЗ (E4-09). Внешняя сеть в тестах не используется — fetch подменяется.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const urlOf = (input: unknown) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);

describe('интеграции по ключам: капча, подсказки адреса, карта', () => {
  let app: INestApplication;
  let fetchMock: MockInstance<typeof fetch>;
  const saved = { captcha: { ...config.captcha }, dadata: { ...config.dadata }, ymapsKey: config.ymapsKey };

  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    // По умолчанию любая попытка выйти в сеть — ошибка сети
    fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('сеть в тестах запрещена'));
  });
  afterEach(() => {
    fetchMock.mockRestore();
    Object.assign(config.captcha, saved.captcha);
    Object.assign(config.dadata, saved.dadata);
    config.ymapsKey = saved.ymapsKey;
  });

  const enableCaptcha = () => {
    config.captcha.serverKey = 'server-key-for-tests';
    config.captcha.clientKey = 'client-key-for-tests';
  };
  const login = (a: ReturnType<typeof agent>, password: string, token?: string) => {
    const req = a.post('/api/auth/login').set('Origin', ORIGIN);
    if (token) req.set('X-Captcha-Token', token);
    return req.send({ email: 'elena@example.ru', password });
  };

  describe('SmartCaptcha', () => {
    it('без ключей капча выключена: конфиг пустой, 6-я попытка входа — 429 без кода, сервис не вызывается', async () => {
      await makeUser(app, 'elena@example.ru');
      expect((await agent(app).get('/api/auth/captcha-config')).body).toEqual({ siteKey: null });
      await app.get(RedisService).client.flushdb();
      const a = agent(app);
      for (let i = 0; i < 5; i++) expect((await login(a, 'wrong-password')).status).toBe(401);
      const res = await login(a, PASSWORD, 'any-token');
      expect(res.status).toBe(429);
      expect(res.body.code).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('с ключом: после порога без токена — captcha_required, с верным токеном — проверка через validate и вход', async () => {
      await makeUser(app, 'elena@example.ru');
      await app.get(RedisService).client.flushdb();
      enableCaptcha();
      expect((await agent(app).get('/api/auth/captcha-config')).body).toEqual({ siteKey: 'client-key-for-tests' });

      const a = agent(app);
      // Лимит входа по email — 5, капча нужна начиная с 5-й попытки (порог 4)
      for (let i = 0; i < 4; i++) expect((await login(a, 'wrong-password')).status).toBe(401);
      const need = await login(a, 'wrong-password');
      expect(need.status).toBe(429);
      expect(need.body.code).toBe('captcha_required');
      expect(fetchMock).not.toHaveBeenCalled();

      // Неверный токен — снова captcha_required
      fetchMock.mockResolvedValueOnce(json({ status: 'failed', message: 'Token invalid or expired.' }));
      const bad = await login(a, 'wrong-password', 'bad-token');
      expect(bad.status).toBe(429);
      expect(bad.body.code).toBe('captcha_required');

      // Верный токен: капча пройдена, дальше обычная проверка пароля; validate вызван один раз на оба счётчика
      fetchMock.mockClear();
      fetchMock.mockImplementation(async () => json({ status: 'ok', message: '', host: 'localhost' }));
      expect((await login(a, 'wrong-password', 'good-token')).status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(urlOf(url)).toBe('https://smartcaptcha.yandexcloud.net/validate');
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('secret')).toBe('server-key-for-tests');
      expect(body.get('token')).toBe('good-token');
      expect(body.get('ip')).toBeTruthy();

      const ok = await login(a, PASSWORD, 'good-token-2');
      expect(ok.status).toBe(200);
      expect((await a.get('/api/auth/me')).status).toBe(200);
    });

    it('сервис капчи недоступен или отвечает 5xx — не пускаем, но и не падаем (429 captcha_required, не 500)', async () => {
      await makeUser(app, 'elena@example.ru');
      await app.get(RedisService).client.flushdb();
      enableCaptcha();
      const a = agent(app);
      for (let i = 0; i < 4; i++) await login(a, 'wrong-password');

      fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      const down = await login(a, PASSWORD, 'token');
      expect(down.status).toBe(429);
      expect(down.body).toMatchObject({ code: 'captcha_required' });
      expect(down.body.message).toMatch(/недоступна/);

      fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
      const err = await login(a, PASSWORD, 'token');
      expect(err.status).toBe(429);
      expect(err.body.code).toBe('captcha_required');
    });

    it('капча и на сбросе пароля, регистрации и заявке поставщика', async () => {
      enableCaptcha();
      const a = agent(app);
      // Сброс: лимит 3 на email → капча с 3-й попытки
      const forgot = (token?: string) => {
        const r = a.post('/api/auth/forgot-password').set('Origin', ORIGIN);
        if (token) r.set('X-Captcha-Token', token);
        return r.send({ email: 'nobody@example.ru' });
      };
      expect((await forgot()).status).toBe(204);
      expect((await forgot()).status).toBe(204);
      expect((await forgot()).body.code).toBe('captcha_required');
      fetchMock.mockResolvedValueOnce(json({ status: 'ok' }));
      expect((await forgot('t')).status).toBe(204);

      // Регистрация: лимит 10 на IP → капча с 9-й
      for (let i = 0; i < 8; i++) {
        const r = await a.post('/api/auth/register').set('Origin', ORIGIN).send({ email: `u${i}@example.ru`, password: PASSWORD, passwordRepeat: PASSWORD, acceptTerms: true });
        expect(r.status).toBe(201);
      }
      const reg = await a.post('/api/auth/register').set('Origin', ORIGIN).send({ email: 'u9@example.ru', password: PASSWORD, passwordRepeat: PASSWORD, acceptTerms: true });
      expect(reg.status).toBe(429);
      expect(reg.body.code).toBe('captcha_required');

      // Заявка поставщика: лимит 5 на IP → капча с 5-й
      const apply = () =>
        agent(app).post('/api/supplier-applications').set('Origin', ORIGIN).send({
          company: 'ООО Тест', inn: '7707083893', contactName: 'Ирина', phone: '+7 999 123-45-67', email: 'sup@example.ru', assortment: 'скрабы', acceptPdn: true,
        });
      for (let i = 0; i < 4; i++) expect((await apply()).status).toBe(201);
      const app5 = await apply();
      expect(app5.status).toBe(429);
      expect(app5.body.code).toBe('captcha_required');
    });
  });

  describe('подсказки адреса DaData', () => {
    const suggestion = (city: string, kladr: string, street: string, house: string) => ({
      value: `г ${city}, ${street}, д ${house}`,
      data: { postal_code: '420111', region_with_type: 'Респ Татарстан', city, city_with_type: `г ${city}`, city_kladr_id: kladr, street_with_type: street, house_type: 'д', house },
    });

    it('без ключа — пустой список, в DaData не ходим; конфиг сайта без карты и подсказок', async () => {
      const res = await agent(app).get('/api/delivery/address-suggest?q=Баумана&city=Казань');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await agent(app).get('/api/delivery/config')).body).toEqual({ mapKey: null, addressSuggest: false });
    });

    it('с ключом: улица/дом/индекс/город и код СДЭК (по справочнику DaData или по названию), кэш на час', async () => {
      config.dadata.apiKey = 'dadata-key-for-tests';
      config.ymapsKey = 'ymaps-key-for-tests';
      expect((await agent(app).get('/api/delivery/config')).body).toEqual({ mapKey: 'ymaps-key-for-tests', addressSuggest: true });

      fetchMock.mockImplementation(async (input, init) => {
        const url = urlOf(input);
        const body = JSON.parse(String(init?.body));
        expect((init?.headers as Record<string, string>).Authorization).toBe('Token dadata-key-for-tests');
        if (url.endsWith('/suggest/address')) {
          expect(body.locations).toEqual([{ city: 'Казань' }, { settlement: 'Казань' }]);
          return json({ suggestions: [suggestion('Казань', '1600000100000', 'ул Баумана', '5'), suggestion('Казань', '1600000100001', 'ул Баумана', '7')] });
        }
        if (url.endsWith('/findById/delivery')) {
          // Для первого КЛАДР DaData знает код СДЭК, для второго — нет (тогда ищем город СДЭК по названию)
          return json({ suggestions: body.query === '1600000100000' ? [{ data: { cdek_id: '424' } }] : [] });
        }
        throw new Error(`неожиданный запрос ${url}`);
      });

      const res = await agent(app).get(`/api/delivery/address-suggest?q=${encodeURIComponent('Баумана 5')}&city=${encodeURIComponent('Казань')}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { value: 'г Казань, ул Баумана, д 5', street: 'ул Баумана, д 5', house: 'д 5', city: 'Казань', region: 'Респ Татарстан', postalCode: '420111', cityCode: 424 },
        { value: 'г Казань, ул Баумана, д 7', street: 'ул Баумана, д 7', house: 'д 7', city: 'Казань', region: 'Респ Татарстан', postalCode: '420111', cityCode: 424 },
      ]);
      const calls = fetchMock.mock.calls.length;

      // Тот же запрос — из Redis, без обращения к DaData
      const again = await agent(app).get(`/api/delivery/address-suggest?q=${encodeURIComponent('Баумана 5')}&city=${encodeURIComponent('Казань')}`);
      expect(again.body).toEqual(res.body);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('DaData недоступна — пустой список, не 500; слишком частые запросы с одного IP — 429', async () => {
      config.dadata.apiKey = 'dadata-key-for-tests';
      fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
      const res = await agent(app).get('/api/delivery/address-suggest?q=Ленина 1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      // Короткий запрос — без обращения к DaData
      fetchMock.mockClear();
      expect((await agent(app).get('/api/delivery/address-suggest?q=Ле')).body).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();

      let last = 0;
      for (let i = 0; i < 60; i++) last = (await agent(app).get('/api/delivery/address-suggest?q=Ле')).status;
      expect(last).toBe(429);
    });
  });

  it('ПВЗ отдаются с координатами (метки на карте), у fake-драйвера — разные точки вокруг центра', async () => {
    const res = await agent(app).get('/api/delivery/points?cityCode=424');
    expect(res.status).toBe(200);
    const pts = res.body as { lat: number; lon: number }[];
    expect(pts.length).toBeGreaterThan(1);
    for (const p of pts) {
      expect(Math.abs(p.lat - 55.79)).toBeLessThan(0.1);
      expect(Math.abs(p.lon - 49.11)).toBeLessThan(0.15);
    }
    expect(new Set(pts.map((p) => `${p.lat},${p.lon}`)).size).toBe(pts.length);
  });
});
