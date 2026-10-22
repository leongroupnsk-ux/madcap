import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { User } from '@prisma/client';
import { rejectSchema } from '@aesculap/shared';
import { CurrentUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ModerationService } from '../products/moderation.service';
import { SuppliersService } from '../suppliers/suppliers.service';

/** Админка MVP (ТЗ §8): заявки поставщиков и очередь модерации. */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('applications')
  applications(@Query('status') status?: 'new' | 'approved' | 'rejected') {
    return this.suppliers.listApplications(status);
  }

  @Post('applications/:id/approve')
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    const supplier = await this.suppliers.approve(id, admin);
    return { supplierId: supplier.id };
  }

  @Post('applications/:id/reject')
  @HttpCode(204)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    return this.suppliers.reject(id, body.reason, admin);
  }

  @Get('moderation')
  queue() {
    return this.moderation.queue();
  }

  @Get('moderation/products/:id')
  details(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.details(id);
  }

  @Post('moderation/products/:id/approve')
  @HttpCode(204)
  approveProduct(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    return this.moderation.approveProduct(id, admin);
  }

  @Post('moderation/products/:id/reject')
  @HttpCode(204)
  rejectProduct(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    return this.moderation.rejectProduct(id, body.reason, admin);
  }

  @Post('moderation/revisions/:id/approve')
  @HttpCode(204)
  approveRevision(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    return this.moderation.approveRevision(id, admin);
  }

  @Post('moderation/revisions/:id/reject')
  @HttpCode(204)
  rejectRevision(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    return this.moderation.rejectRevision(id, body.reason, admin);
  }
}
