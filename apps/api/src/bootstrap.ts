import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Общая настройка приложения — для main.ts и e2e-тестов. */
export function setupApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  // Адрес покупателя (лимиты на IP, учёт просмотров) берётся из X-Forwarded-For. В проде запрос идёт Caddy → сайт
  // (Next.js) → API по внутренней сети docker (172.16.0.0/12), поэтому доверенные прокси — loopback и частные сети.
  // С одним loopback req.ip у всех покупателей был адресом контейнера сайта, и лимиты «на IP» становились общими
  // на весь сайт: после 120 просмотров товаров за 10 минут расчёт доставки отвечал 429 всем (docs/LOAD.md).
  // Подменить адрес снаружи нельзя: Caddy заменяет пришедший X-Forwarded-For настоящим адресом клиента, а порты
  // сайта и API наружу не опубликованы.
  express.set('trust proxy', 'loopback, uniquelocal');
  express.disable('x-powered-by');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
}
