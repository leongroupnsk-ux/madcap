import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './bootstrap';
import { assertProductionConfig, config } from './config';

async function main() {
  assertProductionConfig();
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void main();
