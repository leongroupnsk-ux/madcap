import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp } from '../src/bootstrap';

@Module({})
class EmptyModule {}

/**
 * Адрес покупателя за прокси (docs/LOAD.md). В проде запрос идёт Caddy → сайт → API по сети docker: если API не
 * доверяет частным сетям, req.ip у всех — адрес контейнера сайта, и лимиты на IP становятся общими на весь сайт.
 */
describe('адрес покупателя за прокси', () => {
  let app: NestExpressApplication;
  let ipOf: (remote: string, forwardedFor?: string) => string | undefined;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EmptyModule, { logger: false });
    setupApp(app);
    const proto = (app.getHttpAdapter().getInstance() as { request: object }).request;
    ipOf = (remote, forwardedFor) => {
      const req = Object.create(proto) as { headers: Record<string, string>; socket: object; connection: object; ip?: string };
      req.headers = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};
      req.socket = req.connection = { remoteAddress: remote };
      return req.ip;
    };
  });
  afterAll(() => app.close());

  it('за сайтом в docker — адрес, который поставил Caddy', () => {
    expect(ipOf('::ffff:172.18.0.4', '203.0.113.7')).toBe('203.0.113.7');
    expect(ipOf('172.18.0.4', '203.0.113.7')).toBe('203.0.113.7');
    expect(ipOf('10.0.0.5', '203.0.113.8')).toBe('203.0.113.8');
  });

  it('локально (всё на одной машине) — так же', () => {
    expect(ipOf('127.0.0.1', '203.0.113.7')).toBe('203.0.113.7');
    expect(ipOf('::1')).toBe('::1');
  });

  it('запрос снаружи напрямую: подставленный X-Forwarded-For не принимается', () => {
    expect(ipOf('198.51.100.9', '10.0.0.1')).toBe('198.51.100.9');
    expect(ipOf('198.51.100.9', '203.0.113.7')).toBe('198.51.100.9');
  });
});
