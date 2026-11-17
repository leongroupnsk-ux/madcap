import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ErrorAlertsFilter } from './error-alerts.filter';
import { ErrorAlertsService } from './error-alerts.service';
import { ErrorReportsController } from './error-reports.controller';

/** Сообщения об ошибках API, фоновых задач и сайта в Telegram (docs/DEPLOY.md, «Мониторинг») */
@Module({
  controllers: [ErrorReportsController],
  providers: [ErrorAlertsService, { provide: APP_FILTER, useClass: ErrorAlertsFilter }],
  exports: [ErrorAlertsService],
})
export class MonitoringModule {}
