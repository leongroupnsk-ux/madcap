import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { legalPublishSchema, type LegalPublish } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { ZodPipe } from '../common/zod.pipe';
import { LegalService } from '../common/legal.service';

@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /** Текущая версия; 404 — сайт показывает черновик из кода */
  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const v = await this.legal.current(this.legal.slug(slug));
    if (!v) throw new NotFoundException();
    return { title: v.title, html: v.html, version: this.legal.label(v), publishedAt: v.publishedAt };
  }
}

/** Юридические страницы — у владельца: от версии текста зависят согласия (ТЗ §8, §11) */
@Controller('admin/legal')
@Roles('admin')
@Area('system')
export class AdminLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  list() {
    return this.legal.overview();
  }

  @Get(':slug')
  history(@Param('slug') slug: string) {
    return this.legal.history(this.legal.slug(slug));
  }

  @Post(':slug')
  publish(@Param('slug') slug: string, @Body(new ZodPipe(legalPublishSchema)) body: LegalPublish, @CurrentUser() admin: User) {
    return this.legal.publish(this.legal.slug(slug), body, admin);
  }
}
