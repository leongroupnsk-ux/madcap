import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Общая настройка приложения — для main.ts и e2e-тестов. */
export function setupApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 'loopback');
  express.disable('x-powered-by');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
}
