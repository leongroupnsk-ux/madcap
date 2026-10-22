import { Module } from '@nestjs/common';
import { RedisService } from '../common/redis.service';
import { config } from '../config';
import { FakePaymentsProvider } from './fake.provider';
import { PAYMENTS_PROVIDER } from './payments.provider';
import { YooKassaProvider } from './yookassa.provider';

@Module({
  providers: [
    {
      provide: PAYMENTS_PROVIDER,
      inject: [RedisService],
      useFactory: (redis: RedisService) => (config.payments.driver === 'yookassa' ? new YooKassaProvider() : new FakePaymentsProvider(redis)),
    },
  ],
  exports: [PAYMENTS_PROVIDER],
})
export class PaymentsModule {}
