import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { rejectSchema, reviewCreateSchema, reviewReplySchema, reviewSaveSchema, type ReviewCreateInput, type ReviewSaveInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { Area, Roles } from '../auth/roles.guard';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from '../suppliers/supplier.guard';
import { ReviewsService } from './reviews.service';

/** Отзывы покупателя: свои отзывы, фото, создание и правка (снова на модерацию) */
@Controller('me/reviews')
@UseGuards(AuthGuard)
class MeReviewsController {
  constructor(
    private readonly svc: ReviewsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  mine(@CurrentUser() user: User) {
    return this.svc.mine(user);
  }

  @Get('product/:productId')
  forProduct(@CurrentUser() user: User, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.svc.forProduct(user, productId);
  }

  @Post('photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1048576, files: 1 } }))
  async photo(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException({ message: 'Выберите фото' });
    await this.rateLimit.hit('review-photo', user.id, 30, 3600);
    return this.svc.uploadPhoto(user, file);
  }

  @Post()
  async create(@CurrentUser() user: User, @Body(new ZodPipe(reviewCreateSchema)) body: ReviewCreateInput) {
    await this.rateLimit.hit('review', user.id, 20, 3600);
    return this.svc.create(user, body);
  }

  @Put(':id')
  async update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewSaveSchema)) body: ReviewSaveInput) {
    await this.rateLimit.hit('review', user.id, 20, 3600);
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }
}

/** Очередь отзывов в разделе модерации */
@Controller('admin/reviews')
@Roles('admin')
@Area('moderation')
class AdminReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Get()
  queue(@Query('status') status = 'pending') {
    return this.svc.queue(status === 'approved' || status === 'rejected' ? status : 'pending');
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    return this.svc.decide(id, true, null, admin);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) body: { reason: string }, @CurrentUser() admin: User) {
    return this.svc.decide(id, false, body.reason, admin);
  }
}

/** Кабинет поставщика: одобренные отзывы на свой товар и один ответ на отзыв */
@Controller('supplier/products/:productId/reviews')
@SupplierAccess('owner', 'catalog')
class SupplierReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Get()
  list(@Param('productId', ParseUUIDPipe) productId: string, @CurrentSupplier() ctx: SupplierContext) {
    return this.svc.supplierList(ctx.supplier.id, productId);
  }

  @Post(':id/reply')
  @HttpCode(200)
  reply(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewReplySchema)) body: { text: string },
    @CurrentSupplier() ctx: SupplierContext,
    @CurrentUser() user: User,
  ) {
    return this.svc.reply(ctx.supplier.id, productId, id, body.text, user);
  }
}

@Module({
  imports: [AuthModule, SuppliersModule],
  controllers: [MeReviewsController, AdminReviewsController, SupplierReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
