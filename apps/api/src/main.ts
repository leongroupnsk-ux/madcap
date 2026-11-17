import 'reflect-metadata';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './bootstrap';
import { assertProductionConfig, config } from './config';

async function main() {
  assertProductionConfig();
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  app.enableShutdownHooks();
  // Caddy держит соединения с API открытыми до 60 с (ops/Caddyfile, keepalive). Сервер должен закрывать простаивающее
  // соединение позже прокси, иначе Caddy отправит запрос в соединение, которое Node уже закрыл (по умолчанию — 5 с).
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  await app.listen(config.port);
}

void main();
