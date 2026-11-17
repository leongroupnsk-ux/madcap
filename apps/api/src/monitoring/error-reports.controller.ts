import { Body, Controller, HttpCode, Logger, NotFoundException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { isPrivate } from '../products/remote-fetch';
import { ErrorAlertsService, routeOf } from './error-alerts.service';

const webErrorSchema = z.object({
  route: z.string().max(300),
  method: z.string().max(10).optional(),
  kind: z.string().max(40).optional(),
  message: z.string().max(2000),
  digest: z.string().max(100).optional(),
});
const browserErrorSchema = z.object({
  path: z.string().max(300),
  message: z.string().max(2000),
  stack: z.string().max(4000).optional(),
});

/**
 * Запрос пришёл от сайта изнутри: напрямую из сети docker (или с этой же машины), а не через Caddy. Caddy всегда
 * ставит X-Forwarded-For, поэтому снаружи сюда не попасть, даже если правило в ops/Caddyfile уберут.
 */
function internal(req: Request): boolean {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  return !req.headers['x-forwarded-for'] && isPrivate(remote);
}

/** Ошибки сайта для ErrorAlertsService: рендер на сервере Next.js и экран ошибки в браузере покупателя. */
@Controller()
export class ErrorReportsController {
  private readonly logger = new Logger('ErrorReports');

  constructor(
    private readonly alerts: ErrorAlertsService,
    private readonly limits: RateLimitService,
  ) {}

  /** Сервер Next.js (apps/web/src/instrumentation.ts, onRequestError) — только изнутри */
  @Post('internal/errors')
  @HttpCode(204)
  async web(@Req() req: Request, @Body(new ZodPipe(webErrorSchema)) body: z.infer<typeof webErrorSchema>) {
    if (!internal(req)) throw new NotFoundException();
    const where = `${body.method ?? 'GET'} ${body.route}${body.kind ? ` (${body.kind})` : ''}`;
    await this.alerts.report({ source: 'web', where, message: body.message });
  }

  /**
   * Экран ошибки в браузере (app/(shop)/error.tsx) из-за сбоя в самом браузере; сбои сервера сайт уже сообщил сам.
   * Публичный: не больше 10 сообщений за 10 минут с адреса, текст — без ссылок и персональных данных (scrub),
   * в Telegram — с пометкой, что пришло из браузера.
   */
  @Post('client-errors')
  @HttpCode(204)
  async browser(@Req() req: Request, @Body(new ZodPipe(browserErrorSchema)) body: z.infer<typeof browserErrorSchema>) {
    await this.limits.hit('client-error', req.ip ?? 'unknown', 10, 600);
    if (body.stack) this.logger.warn(`${routeOf(body.path)}: ${body.stack.slice(0, 2000)}`);
    await this.alerts.report({ source: 'browser', where: routeOf(body.path), message: body.message });
  }
}
