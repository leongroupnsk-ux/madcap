import { Controller, Get, Query } from '@nestjs/common';
import { Area, Roles } from '../auth/roles.guard';
import { CatalogService } from './catalog.service';

/** Аналитика поиска (раздел «Справочники и витрина»): запросы, по которым витрина ничего не нашла. */
@Controller('admin/search')
@Roles('admin')
@Area('catalog')
export class AdminSearchController {
  constructor(private readonly catalog: CatalogService) {}

  /**
   * GET /api/admin/search/empty?days=30&limit=100&q=халат — самые частые пустые запросы, у которых
   * последний поиск был за days дней (1–365, по умолчанию 30); limit — 1–500 (100); q — фильтр по подстроке.
   */
  @Get('empty')
  empty(@Query('days') days?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    const clamp = (v: string | undefined, def: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v)) || def));
    return this.catalog.emptyQueries(clamp(days, 30, 365), clamp(limit, 100, 500), typeof q === 'string' && q.trim() ? q.slice(0, 100) : undefined);
  }
}
