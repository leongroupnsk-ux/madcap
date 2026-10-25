import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  premiumAnswersSchema, premiumCapsuleRequestSchema, premiumLeadSchema, premiumLeadUpdateSchema,
  type PremiumAnswers, type PremiumCapsuleRequest, type PremiumLeadInput, type PremiumLeadUpdate,
} from '@aesculap/shared';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { ZodPipe } from '../common/zod.pipe';
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
  constructor(private readonly premium: PremiumService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.premium.list(status);
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.premium.view(id);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(premiumLeadUpdateSchema)) body: PremiumLeadUpdate, @CurrentUser() staff: User) {
    return this.premium.update(id, body, staff);
  }
}
