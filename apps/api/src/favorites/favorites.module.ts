import { Body, Controller, Delete, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { favoritesMergeSchema, restockSubscribeSchema, type RestockSubscribeInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { SessionService } from '../auth/session.service';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { FavoritesService } from './favorites.service';
import { RestockService } from './restock.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Избранное вошедшего покупателя */
@Controller('me/favorites')
@UseGuards(AuthGuard)
class MeFavoritesController {
  constructor(private readonly svc: FavoritesService) {}

  @Get()
  async list(@CurrentUser() user: User) {
    const ids = await this.svc.ids(user.id);
    return { ids, items: await this.svc.cards(ids) };
  }

  /** Только id — для синхронизации браузера */
  @Get('ids')
  async ids(@CurrentUser() user: User) {
    return { ids: await this.svc.ids(user.id) };
  }

  @Put(':productId')
  add(@CurrentUser() user: User, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.svc.add(user.id, productId);
  }

  @Delete(':productId')
  remove(@CurrentUser() user: User, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.svc.remove(user.id, productId);
  }

  /** Перенос избранного гостя из браузера при входе */
  @Post('merge')
  @HttpCode(200)
  merge(@CurrentUser() user: User, @Body(new ZodPipe(favoritesMergeSchema)) body: { productIds: string[] }) {
    return this.svc.merge(user.id, body.productIds);
  }
}

/** Подписки вошедшего на поступление */
@Controller('me/restock')
@UseGuards(AuthGuard)
class MeRestockController {
  constructor(private readonly restock: RestockService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.restock.mine(user);
  }

  @Get('product/:productId')
  forProduct(@CurrentUser() user: User, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.restock.forProduct(user, productId);
  }

  @Delete(':id')
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.restock.cancelMine(user, id);
  }
}

/** Публичное: карточки избранного гостя и подписка «Сообщить о поступлении» */
@Controller()
class PublicFavoritesController {
  constructor(
    private readonly favorites: FavoritesService,
    private readonly restock: RestockService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Карточки избранного гостя (id из браузера), включая товары без остатка */
  @Get('catalog/favorites')
  async cards(@Query('ids') ids = '') {
    return { items: await this.favorites.cards(String(ids).split(',').filter((x) => UUID.test(x)).slice(0, 200)) };
  }

  /** Вошедший подписывается одним кликом на свой email; гость — вводит email и даёт согласие (лимит по IP) */
  @Post('restock')
  @HttpCode(200)
  async subscribe(@Body(new ZodPipe(restockSubscribeSchema)) body: RestockSubscribeInput, @Req() req: Request) {
    const session = await this.sessions.resolve(req).catch(() => null);
    const ip = req.ip ?? 'unknown';
    if (session) await this.rateLimit.hit('restock-user', session.user.id, 30, 3600);
    else await this.rateLimit.hit('restock', ip, 5, 3600);
    return this.restock.subscribe(body, session?.user ?? null, ip);
  }

  /** Отписка: токен в JSON-теле (страница /restock/unsubscribe) или в query (one-click по List-Unsubscribe) */
  @Post('restock/unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Query('token') queryToken: string | undefined, @Body() body: unknown, @Req() req: Request) {
    await this.rateLimit.hit('unsubscribe', req.ip ?? 'unknown', 30, 60);
    const bodyToken = body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string' ? (body as { token: string }).token : '';
    return this.restock.unsubscribe(String(bodyToken || queryToken || '').slice(0, 200), req.ip ?? 'unknown');
  }
}

/** Глобальный: RestockService вызывают товары поставщика, импорт и заказы после изменения остатков */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MeFavoritesController, MeRestockController, PublicFavoritesController],
  providers: [FavoritesService, RestockService],
  exports: [RestockService],
})
export class FavoritesModule {}
