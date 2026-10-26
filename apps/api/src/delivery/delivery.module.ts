import { BadRequestException, Controller, Get, Module, ParseIntPipe, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimitService } from '../common/rate-limit.service';
import { config } from '../config';
import { AddressSuggestService } from './address-suggest.service';
import { CdekProvider } from './cdek.provider';
import { DELIVERY_PROVIDER } from './delivery.provider';
import { DeliveryService } from './delivery.service';
import { FakeDeliveryProvider } from './fake.provider';

@Controller('delivery')
class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly addresses: AddressSuggestService,
    private readonly limits: RateLimitService,
  ) {}

  /**
   * Что включено на сайте: ключ Яндекс Карт для карты ПВЗ (публичный, ограничивается по Referer в кабинете
   * разработчика) и подсказки адреса DaData. Страница оформления берёт это на сервере, браузер отдельно не ходит.
   */
  @Get('config')
  siteConfig() {
    return { mapKey: config.ymapsKey || null, addressSuggest: this.addresses.enabled };
  }

  /** Подсказки адреса курьера (DaData через сервер). Без DADATA_API_KEY — пустой список. */
  @Get('address-suggest')
  async addressSuggest(@Query('q') q: unknown, @Query('city') city: unknown, @Req() req: Request) {
    if (!this.addresses.enabled || typeof q !== 'string') return [];
    await this.limits.hit('addr-suggest', req.ip ?? 'unknown', 60, 60);
    return this.addresses.suggest(q, typeof city === 'string' ? city : undefined);
  }

  @Get('cities')
  cities(@Query('q') q = '') {
    return this.delivery.cities(String(q).slice(0, 60));
  }

  @Get('points')
  points(@Query('cityCode', ParseIntPipe) cityCode: number) {
    if (cityCode <= 0) throw new BadRequestException();
    return this.delivery.points(cityCode);
  }
}

@Module({
  controllers: [DeliveryController],
  providers: [DeliveryService, AddressSuggestService, { provide: DELIVERY_PROVIDER, useFactory: () => (config.delivery.driver === 'cdek' ? new CdekProvider() : new FakeDeliveryProvider()) }],
  exports: [DeliveryService],
})
export class DeliveryModule {}
