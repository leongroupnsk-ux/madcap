import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  premiumAnswersSchema, premiumCapsuleRequestSchema, premiumLeadSchema, premiumLeadUpdateSchema, premiumMessageSchema, premiumOrderSchema, premiumQuoteSchema,
  type PremiumAnswers, type PremiumCapsuleRequest, type PremiumLeadInput, type PremiumLeadUpdate, type PremiumMessageInput, type PremiumOrderInput,
} from '@aesculap/shared';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { ZodPipe } from '../common/zod.pipe';
import { RateLimitService } from '../common/rate-limit.service';
import { AuditService } from '../common/audit.service';
import { PremiumMessagesService } from './premium-messages.service';
import { PremiumOrderService } from './premium-order.service';
import { PremiumService } from './premium.service';

const saveSchema = premiumAnswersSchema.extend({ complete: z.boolean().optional() });

/** Премиальный подбор: публичный расчёт капсулы и заявка менеджеру; ответы анкеты вошедшего — в его записи. */
@Controller('premium')
export class PremiumController {
  constructor(
    private readonly premium: PremiumService,
    private readonly sessions: SessionService,
  ) {}

  /** Расчёт без записи в базу: гостю анкета и капсула доступны без регистрации */
  @Post('capsule')
  @HttpCode(200)
  capsule(@Body(new ZodPipe(premiumCapsuleRequestSchema)) body: PremiumCapsuleRequest) {
    return this.premium.capsule(body);
  }

  /** Способы связи в форме заявки: Telegram — только если бот платформы подключён */
  @Get('contact-options')
  contactOptions() {
    return this.premium.contactOptions();
  }

  @Post('leads')
  async lead(@Body(new ZodPipe(premiumLeadSchema)) body: PremiumLeadInput, @Req() req: Request) {
    const s = await this.sessions.resolve(req).catch(() => null);
    return this.premium.createLead(body, req.ip ?? 'unknown', s?.user ?? null);
  }

  @Get('answers')
  @UseGuards(AuthGuard)
  answers(@CurrentUser() user: User) {
    return this.premium.answers(user);
  }

  @Put('answers')
  @UseGuards(AuthGuard)
  save(@CurrentUser() user: User, @Body(new ZodPipe(saveSchema)) body: PremiumAnswers & { complete?: boolean }) {
    const { complete, ...patch } = body;
    return this.premium.saveAnswers(user, patch, complete);
  }
}

/** «Заявки премиум» в админке: список, карточка с капсулой и ответами, статус и комментарий менеджера */
@Controller('admin/premium')
@Roles('admin')
@Area('premium')
export class AdminPremiumController {
  constructor(
    private readonly premium: PremiumService,
    private readonly orders: PremiumOrderService,
    private readonly messages: PremiumMessagesService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.premium.list(status);
  }

  /** Непрочитанные сообщения клиентов по всем заявкам — для счётчика в меню админки */
  @Get('unread')
  async unread() {
    return { count: await this.messages.unreadTotal() };
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.premium.view(id);
  }

  /** «Создать заказ»: получатель, состав капсулы с ценами и наличием на сейчас */
  @Get(':id/order-draft')
  draft(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.draft(id);
  }

  @Post(':id/quote')
  @HttpCode(200)
  async quote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(premiumQuoteSchema)) body: { cityCode: number; variantIds: string[] }, @CurrentUser() staff: User) {
    await this.limits.hit('premium-quote', staff.id, 120, 600);
    return this.orders.quote(id, body.cityCode, body.variantIds);
  }

  @Post(':id/order')
  async order(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(premiumOrderSchema)) body: PremiumOrderInput, @CurrentUser() staff: User) {
    await this.limits.hit('premium-order', staff.id, 20, 600);
    return this.orders.create(id, body, staff);
  }

  /** Повторная ссылка на оплату покупателю */
  @Post(':id/order/resend')
  @HttpCode(200)
  async resend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() staff: User) {
    await this.limits.hit('premium-order', staff.id, 20, 600);
    return this.orders.resend(id, staff);
  }

  /** Ответ клиенту в Telegram или заметка «написал в WhatsApp» в ленту заявки */
  @Post(':id/messages')
  async message(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(premiumMessageSchema)) body: PremiumMessageInput, @CurrentUser() staff: User) {
    await this.limits.hit('premium-message', staff.id, 60, 600);
    return this.messages.post(id, body, staff);
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id', ParseUUIDPipe) id: string) {
    await this.premium.view(id);
    return this.messages.markRead(id);
  }

  /** Новая одноразовая ссылка на бота (клиент потерял ссылку или выбрал другой способ связи) */
  @Post(':id/telegram-link')
  @HttpCode(200)
  async telegramLink(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() staff: User) {
    await this.premium.view(id);
    const link = await this.messages.issueLink(id);
    if (!link) throw new BadRequestException({ message: 'Telegram-бот не подключён (нет TELEGRAM_BOT_TOKEN)' });
    await this.audit.log(staff.id, 'premium.lead.telegram_link_issue', 'premium_lead', id);
    return link;
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(premiumLeadUpdateSchema)) body: PremiumLeadUpdate, @CurrentUser() staff: User) {
    return this.premium.update(id, body, staff);
  }
}
