import { Body, Controller, Delete, Get, Global, HttpCode, Module, Post, Put } from '@nestjs/common';
import { notificationSettingsSchema, telegramLinkSchema } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';

const readSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });

@Controller('supplier/notifications')
@SupplierAccess()
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return this.svc.list(user, ctx.supplier.id);
  }

  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext, @Body(new ZodPipe(readSchema)) body: { ids?: string[] }) {
    return this.svc.markRead(user, ctx.supplier.id, body.ids);
  }

  @Get('settings')
  settings(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return this.svc.settings(user, ctx.supplier.id);
  }

  @Put('settings')
  save(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext, @Body(new ZodPipe(notificationSettingsSchema)) body: { email: boolean; mutedEvents: string[] }) {
    return this.svc.saveSettings(user, ctx.supplier.id, body);
  }

  @Post('telegram')
  @HttpCode(200)
  link(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext, @Body(new ZodPipe(telegramLinkSchema)) body: { code: string }) {
    return this.svc.linkTelegram(user, ctx.supplier.id, body.code);
  }

  @Delete('telegram')
  unlink(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return this.svc.unlinkTelegram(user, ctx.supplier.id);
  }
}

/** Уведомления доступны всем модулям без импорта (как почта). */
@Global()
@Module({ imports: [AuthModule], controllers: [NotificationsController], providers: [NotificationsService, TelegramService], exports: [NotificationsService] })
export class NotificationsModule {}
