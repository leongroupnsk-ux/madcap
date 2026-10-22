import { BadRequestException, Controller, Get, Module, ParseIntPipe, Query } from '@nestjs/common';
import { config } from '../config';
import { CdekProvider } from './cdek.provider';
import { DELIVERY_PROVIDER } from './delivery.provider';
import { DeliveryService } from './delivery.service';
import { FakeDeliveryProvider } from './fake.provider';

@Controller('delivery')
class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

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
  providers: [DeliveryService, { provide: DELIVERY_PROVIDER, useFactory: () => (config.delivery.driver === 'cdek' ? new CdekProvider() : new FakeDeliveryProvider()) }],
  exports: [DeliveryService],
})
export class DeliveryModule {}
