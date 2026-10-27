import { Controller, Get, Query } from '@nestjs/common';
import { Area, Roles } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';

/** Дашборд платформы — стартовая страница админки владельца и поддержки (область «Дашборд») */
@Controller('admin/dashboard')
@Roles('admin')
@Area('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** refresh=1 — пересчитать, не дожидаясь истечения кэша (кнопка «Обновить») */
  @Get()
  get(@Query('refresh') refresh?: string) {
    return this.dashboard.get(refresh === '1');
  }
}
