import { Controller, Get, Header } from '@nestjs/common';
import { config } from '../config';

/** Публичные настройки сайта, которые не секретны и нужны браузеру (сайт берёт их на сервере и кэширует на 5 минут). */
@Controller('public-config')
export class PublicConfigController {
  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  get() {
    return { metrikaId: config.metrikaId };
  }
}
