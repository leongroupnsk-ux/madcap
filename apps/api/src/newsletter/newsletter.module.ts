import { Body, Controller, Get, HttpCode, Module, OnApplicationBootstrap, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { JobsService } from '../common/jobs.service';
import { RateLimitService } from '../common/rate-limit.service';
import { NEWSLETTER_JOB, NewsletterService } from './newsletter.service';

/** Запуск рассылки по акции из админки (область «Акции»). */
@Controller('admin/promotions/:id/newsletter')
@Roles('admin')
@Area('promotions')
class AdminNewsletterController {
  constructor(private readonly svc: NewsletterService) {}

  @Get()
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.preview(id);
  }

  @Post()
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    return this.svc.start(id, admin);
  }
}

/**
 * Публичная отписка. Токен — в JSON-теле (страница /unsubscribe) или в query: так приходит
 * one-click POST почтового клиента по заголовку List-Unsubscribe (RFC 8058, без Origin и cookie).
 */
@Controller('newsletter')
class UnsubscribeController {
  constructor(
    private readonly svc: NewsletterService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Query('token') queryToken: string | undefined, @Body() body: unknown, @Req() req: Request) {
    await this.rateLimit.hit('unsubscribe', req.ip ?? 'unknown', 30, 60);
    const bodyToken = body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string' ? (body as { token: string }).token : '';
    return this.svc.unsubscribe(String(bodyToken || queryToken || '').slice(0, 200), req.ip ?? 'unknown');
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AdminNewsletterController, UnsubscribeController],
  providers: [NewsletterService],
})
export class NewsletterModule implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly svc: NewsletterService,
  ) {}

  onApplicationBootstrap() {
    this.jobs.register(NEWSLETTER_JOB, (data: { promotionId: string }) => this.svc.run(data.promotionId));
  }
}
