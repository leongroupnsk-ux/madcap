import Link from 'next/link';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { ButtonLink } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';

type Summary = {
  total: number; published: number; onModeration: number; zeroStock: number;
  lastImport: { id: string; fileName: string | null; status: string; totalRows: number; newProducts: number; updates: number; errorRows: number; createdAt: string } | null;
};

export default async function DashboardPage() {
  const me = await requireSupplier();
  if (!me) return null;
  const canCatalog = me.role !== 'warehouse';
  const summary = canCatalog ? (await serverApi<Summary>('/supplier/products/summary')).data : null;
  const setupNeeded = !me.supplier.warehouseAddress || !me.supplier.cdekCityCode;
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Дашборд</div>
          <h1>Добрый день, {me.supplier.legalName}.</h1>
        </div>
        {canCatalog && <ButtonLink href="/supplier/products/new">Добавить товар</ButtonLink>}
      </div>

      {setupNeeded && me.role === 'owner' && (
        <div className={s.panel} style={{ marginBottom: 24, background: '#f9eeda' }}>
          <b>Заполните склад отгрузки.</b> Без адреса склада и кода города СДЭК не посчитать доставку.{' '}
          <Link href="/supplier/settings" className={s.link}>
            Перейти в настройки →
          </Link>
        </div>
      )}

      {summary && (
        <div className={s.tiles}>
          <Link href="/supplier/products" className={s.tile}>
            <span className={s.tileLabel}>Товаров</span>
            <b>{summary.total}</b>
            <span className={s.tileHint}>опубликовано: {summary.published}</span>
          </Link>
          <Link href="/supplier/products?status=pending" className={s.tile}>
            <span className={s.tileLabel}>На модерации</span>
            <b>{summary.onModeration}</b>
            <span className={s.tileHint}>обычно до 24 часов</span>
          </Link>
          <Link href="/supplier/products?status=out_of_stock" className={s.tile}>
            <span className={s.tileLabel}>Нулевые остатки</span>
            <b>{summary.zeroStock}</b>
            <span className={s.tileHint}>опубликованные без наличия</span>
          </Link>
          <div className={s.tile}>
            <span className={s.tileLabel}>Новые заказы</span>
            <b>—</b>
            <span className={s.tileHint}>заказы появятся на этапе 4</span>
          </div>
        </div>
      )}

      {canCatalog && (
        <section className={s.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Импорт каталога</h2>
            <Link href="/supplier/import" className={s.link}>
              Все источники →
            </Link>
          </div>
          {summary?.lastImport ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <b>{summary.lastImport.fileName}</b> · <Badge status={summary.lastImport.status} />
                <div className={s.muted}>
                  {summary.lastImport.totalRows} строк: {summary.lastImport.newProducts} новых · {summary.lastImport.updates} обновлений ·{' '}
                  <span style={{ color: summary.lastImport.errorRows ? 'var(--c-sale)' : undefined }}>{summary.lastImport.errorRows} с ошибками</span>
                </div>
              </div>
              <ButtonLink href="/supplier/import" variant="outline">
                Загрузить ещё файл
              </ButtonLink>
            </div>
          ) : (
            <p className={s.muted}>
              Импортов ещё не было. Загрузите таблицу по шаблону или подключите YML-фид из 1С / МоегоСклада.
            </p>
          )}
        </section>
      )}
    </>
  );
}
