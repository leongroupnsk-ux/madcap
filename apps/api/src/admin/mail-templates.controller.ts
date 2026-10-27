import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { mailTemplateSaveSchema, type MailTemplateSaveInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { MailTemplatesService } from '../common/mail-templates.service';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';

/**
 * Шаблоны писем — область «system» (только владелец). Не «editorial»: среди писем — сброс пароля, приглашения
 * сотрудников и поставщиков; правка их текста — готовый канал фишинга от имени площадки, поэтому доступ — как к
 * сотрудникам и настройкам безопасности. Все изменения — в журнале действий.
 */
@Controller('admin/system/mail-templates')
@Roles('admin')
@Area('system')
export class MailTemplatesController {
  constructor(
    private readonly templates: MailTemplatesService,
    private readonly limits: RateLimitService,
  ) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Get(':key')
  view(@Param('key') key: string) {
    return this.templates.view(key);
  }

  @Put(':key')
  save(@Param('key') key: string, @Body(new ZodPipe(mailTemplateSaveSchema)) body: MailTemplateSaveInput, @CurrentUser() admin: User) {
    return this.templates.save(key, body, admin);
  }

  /** Сброс к стандартному тексту из кода */
  @Delete(':key')
  reset(@Param('key') key: string, @CurrentUser() admin: User) {
    return this.templates.reset(key, admin);
  }

  /** Предпросмотр черновика из формы на тестовых данных (без сохранения) */
  @Post(':key/preview')
  @HttpCode(200)
  preview(@Param('key') key: string, @Body(new ZodPipe(mailTemplateSaveSchema)) body: MailTemplateSaveInput) {
    return this.templates.preview(key, body);
  }

  /** Тестовое письмо себе: черновик из формы на тестовых данных */
  @Post(':key/test')
  @HttpCode(200)
  async test(@Param('key') key: string, @Body(new ZodPipe(mailTemplateSaveSchema)) body: MailTemplateSaveInput, @CurrentUser() admin: User) {
    await this.limits.hit('mail-template-test', admin.id, 10, 3600);
    return this.templates.test(key, body, admin);
  }
}
