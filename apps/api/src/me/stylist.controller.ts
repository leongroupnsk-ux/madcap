import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { stylistAnswerSchema, stylistRequestSchema, type StylistRequestInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Area, Roles } from '../auth/roles.guard';
import { ZodPipe } from '../common/zod.pipe';
import { StylistService } from './stylist.service';

@Controller('me/stylist')
@UseGuards(AuthGuard)
export class MeStylistController {
  constructor(private readonly stylist: StylistService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.stylist.list(user);
  }

  @Post()
  create(@CurrentUser() user: User, @Body(new ZodPipe(stylistRequestSchema)) body: StylistRequestInput) {
    return this.stylist.create(user, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.stylist.cancel(user, id);
  }
}

/** Рабочее место стилиста (ТЗ §8): очередь запросов, анкета и фото по открытому запросу, ответ */
@Controller('admin/stylist')
@Roles('admin')
@Area('stylist')
export class AdminStylistController {
  constructor(private readonly stylist: StylistService) {}

  @Get()
  queue(@Query('status') status?: string) {
    return this.stylist.queue(status === 'answered' ? 'answered' : 'open');
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() staff: User) {
    return this.stylist.view(id, staff);
  }

  @Get(':id/photos/:photoId')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'private, no-store')
  async photo(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @CurrentUser() staff: User) {
    return new StreamableFile(await this.stylist.photo(id, photoId, staff));
  }

  @Post(':id/answer')
  @HttpCode(200)
  answer(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stylistAnswerSchema)) body: { answer: string }, @CurrentUser() staff: User) {
    return this.stylist.answer(id, body.answer, staff);
  }
}
