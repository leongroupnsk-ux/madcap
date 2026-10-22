import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { addressSchema, cartLineSchema, cartSchema, checkoutSchema, returnRequestSchema, type AddressInput, type CartLineInput, type CheckoutInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { FakePaymentsProvider } from '../payments/fake.provider';
import { CartService } from './cart.service';
import { OrdersService } from './orders.service';
import { SupplierOrdersService } from './supplier-orders.service';
import { fromYooKassa } from './webhook-ip';

const quoteSchema = z.object({ lines: z.array(cartLineSchema).max(100), cityCode: z.number().int().positive() });
const orderSchema = checkoutSchema.and(z.object({ lines: z.array(cartLineSchema).min(1).max(100) }));
const testPaySchema = z.object({ result: z.enum(['card', 'sbp', 'fail']) });

@Controller()
export class OrdersController {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
    private readonly supplierOrders: SupplierOrdersService,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ─── корзина ─────────────────────────────────────────────────────────

  @Get('cart')
  @UseGuards(AuthGuard)
  getCart(@CurrentUser() user: User) {
    return this.cart.get(user.id);
  }

  @Put('cart')
  @UseGuards(AuthGuard)
  putCart(@CurrentUser() user: User, @Body(new ZodPipe(cartSchema)) body: { lines: CartLineInput[] }) {
    return this.cart.replace(user.id, body.lines);
  }

  @Post('cart/check')
  @HttpCode(200)
  async check(@Body(new ZodPipe(cartSchema)) body: { lines: CartLineInput[] }) {
    return { items: await this.cart.check(body.lines) };
  }

  @Post('checkout/quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(quoteSchema)) body: { lines: CartLineInput[]; cityCode: number }) {
    return this.orders.quote(body.lines, body.cityCode);
  }

  // ─── адреса ──────────────────────────────────────────────────────────

  @Get('me/addresses')
  @UseGuards(AuthGuard)
  addresses(@CurrentUser() user: User) {
    return this.prisma.address.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
  }

  @Post('me/addresses')
  @UseGuards(AuthGuard)
  async addAddress(@CurrentUser() user: User, @Body(new ZodPipe(addressSchema)) body: AddressInput) {
    if ((await this.prisma.address.count({ where: { userId: user.id } })) >= 20) throw new BadRequestException({ message: 'Не больше 20 адресов' });
    return this.prisma.address.create({ data: { userId: user.id, ...body } });
  }

  @Delete('me/addresses/:id')
  @UseGuards(AuthGuard)
  async deleteAddress(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.address.deleteMany({ where: { id, userId: user.id } });
    return { ok: true };
  }

  // ─── заказы ──────────────────────────────────────────────────────────

  @Post('orders')
  @UseGuards(AuthGuard)
  async create(@CurrentUser() user: User, @Body(new ZodPipe(orderSchema)) body: CheckoutInput & { lines: CartLineInput[] }) {
    await this.rateLimit.hit('order', user.id, 10, 600);
    return this.orders.create(user, body.lines, body);
  }

  @Get('orders')
  @UseGuards(AuthGuard)
  list(@CurrentUser() user: User) {
    return this.orders.list(user);
  }

  @Get('orders/:number')
  @UseGuards(AuthGuard)
  view(@CurrentUser() user: User, @Param('number') number: string) {
    return this.orders.view(user, number);
  }

  @Post('orders/:number/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  cancel(@CurrentUser() user: User, @Param('number') number: string) {
    return this.orders.cancelByBuyer(user, number);
  }

  @Post('orders/:number/pay')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  pay(@CurrentUser() user: User, @Param('number') number: string) {
    return this.orders.retryPayment(user, number);
  }

  @Post('orders/:number/shipments/:no/return')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  requestReturn(
    @CurrentUser() user: User,
    @Param('number') number: string,
    @Param('no', ParseIntPipe) no: number,
    @Body(new ZodPipe(returnRequestSchema)) body: { items: { itemId: string; qty: number }[]; reason: string },
  ) {
    return this.orders.requestReturn(user, number, no, body);
  }

  // ─── уведомления платёжки и СДЭК ─────────────────────────────────────

  /** Вебхук ЮKassa: принимаем только id, статус перечитываем через API. */
  @Post('payments/webhook')
  @HttpCode(200)
  async paymentWebhook(@Req() req: Request, @Body() body: { event?: string; object?: { id?: string; payment_id?: string } }) {
    if (this.orders.payments.name === 'yookassa' && config.isProd && !fromYooKassa(req.ip ?? '')) throw new ForbiddenException();
    const id = body?.object?.payment_id ?? body?.object?.id;
    if (typeof id !== 'string' || !body.event) throw new BadRequestException();
    await this.prisma.webhookEvent.upsert({
      where: { source_objectId_event: { source: 'yookassa', objectId: id, event: body.event } },
      update: {},
      create: { source: 'yookassa', objectId: id, event: body.event, payload: body as object },
    });
    if (body.event.startsWith('payment.')) await this.orders.handlePayment(id);
    return { ok: true };
  }

  /** Вебхук СДЭК ORDER_STATUS: по uuid перечитываем заказ в СДЭК. */
  @Post('delivery/cdek-webhook')
  @HttpCode(200)
  async cdekWebhook(@Body() body: { type?: string; uuid?: string; attributes?: { code?: string } }) {
    if (body?.type !== 'ORDER_STATUS' || typeof body.uuid !== 'string') return { ok: true };
    await this.prisma.webhookEvent.upsert({
      where: { source_objectId_event: { source: 'cdek', objectId: body.uuid, event: body.attributes?.code ?? 'status' } },
      update: {},
      create: { source: 'cdek', objectId: body.uuid, event: body.attributes?.code ?? 'status', payload: body as object },
    });
    await this.supplierOrders.syncByCdekUuid(body.uuid);
    return { ok: true };
  }

  // ─── тестовая оплата (только PAYMENTS_DRIVER=fake) ───────────────────

  private fake() {
    if (!(this.orders.payments instanceof FakePaymentsProvider)) throw new NotFoundException();
    return this.orders.payments;
  }

  @Get('payments/test/:id')
  async testPayment(@Param('id') id: string) {
    const p = await this.fake().load(id);
    return { id: p.id, status: p.status, amount: p.amount, description: p.description, shop: config.brandName, orderNumber: p.metadata.orderNumber };
  }

  @Post('payments/test/:id')
  @HttpCode(200)
  async settleTest(@Param('id') id: string, @Body(new ZodPipe(testPaySchema)) body: { result: 'card' | 'sbp' | 'fail' }) {
    const p = await this.fake().settle(id, body.result);
    // Имитация вебхука ЮKassa
    await this.orders.handlePayment(id);
    return { status: p.status, orderNumber: p.metadata.orderNumber };
  }
}
