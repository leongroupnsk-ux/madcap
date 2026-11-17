import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import { ErrorAlertsService, routeOf } from './error-alerts.service';

/**
 * Все ошибки API проходят через стандартный обработчик Nest (ответ и лог те же), а сбои — непойманные исключения
 * и ответы 5xx — дополнительно уходят в ErrorAlertsService. Ошибки клиента (4xx) — не сбой, о них не сообщается.
 */
@Catch()
export class ErrorAlertsFilter extends BaseExceptionFilter {
  constructor(
    private readonly alerts: ErrorAlertsService,
    adapterHost: HttpAdapterHost,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500 && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<Request>();
      // Шаблон маршрута (/api/catalog/products/:slug), а не адрес: одинаковые ошибки на разных товарах — один вид
      const route = (req.route as { path?: string } | undefined)?.path ?? routeOf(req.originalUrl ?? req.url);
      const message = exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception);
      void this.alerts.report({ source: 'api', where: `${req.method} ${route}`, message });
    }
    super.catch(exception, host);
  }
}
