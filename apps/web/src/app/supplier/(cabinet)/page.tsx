import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { ActionOrders } from './ActionOrders';
import s from '@/components/supplier/cabinet.module.css';
import { FileIcon } from '@/components/supplier/FileIcon';
import { ButtonLink } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';

type Summary = {
  total: number; published: number; onModeration: number; zeroStock: number;
  lastImport: { id: string; fileName: string | null; status: string; totalRows: number; newProducts: number; updates: number; errorRows: number; createdAt: string } | null;
};

type Counters = { fresh: number; overdue: number; toShip: number; returns: number; salesMonth: number; zeroInCapsules: number };

const IMPORT_STATUS: Record<string, string> = {
  queued: 'в очереди', checking: 'проверяем', checked: 'проверен', applying: 'применяем', applied: 'применён', failed: 'ошибка',
};

/** Дашборд кабинета (кадр .Partner-Main): метрики, последний импорт, заказы, требующие действий. */
export default async function DashboardPage() {
  const me = await requireSupplier();
  if (!me) return null;
  const canCatalog = me.role !== 'warehouse';
  const canOrders = me.role !== 'catalog';
  const [summary, counters] = await Promise.all([
    canCatalog ? serverApi<Summary>('/supplier/products/summary').then((r) => r.data) : null,
    serverApi<Counters>('/supplier/orders/counters').then((r) => r.data),
  ]);
  const setupNeeded = !me.supplier.warehouseAddress || !me.supplier.cdekCityCode;
  const month = new Date().toLocaleString('ru-RU', { month: 'long', timeZone: 'Europe/Moscow' });
  const last = summary?.lastImport;
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
        <div className={s.notice}>
          <b>Заполните склад отгрузки.</b> Без адреса склада и кода города СДЭК не посчитать доставку.{' '}
          <Link href="/supplier/settings" className={s.link}>
            Перейти в настройки →
          </Link>
        </div>
      )}

      <div className={s.tiles}>
        {canOrders && counters && (
          <Link href="/supplier/orders?status=new" className={s.tile}>
            <span className={s.tileLabel}>Новые заказы</span>
            <b>{counters.fresh}</b>
            <span className={`${s.tileHint} ${counters.overdue ? s.tileWarn : ''}`}>
              {counters.overdue ? `${counters.overdue} ждёт подтверждения больше суток` : counters.toShip ? `к отгрузке: ${counters.toShip}` : 'все обработаны'}
            </span>
          </Link>
        )}
        {summary && (
          <Link href="/supplier/products?status=pending" className={s.tile}>
            <span className={s.tileLabel}>На модерации</span>
            <b>{summary.onModeration}</b>
            <span className={s.tileHint}>обычно до 24 часов</span>
          </Link>
        )}
        {summary && (
          <Link href="/supplier/products?status=out_of_stock" className={s.tile}>
            <span className={s.tileLabel}>Нулевые остатки</span>
            <b>{summary.zeroStock}</b>
            <span className={`${s.tileHint} ${counters?.zeroInCapsules ? s.tileWarn : ''}`}>
              {counters?.zeroInCapsules ? `${counters.zeroInCapsules} — из активных капсул` : 'в капсулах покупателей — нет'}
            </span>
          </Link>
        )}
        {counters && me.role === 'owner' && (
          <Link href="/supplier/payouts" className={s.tile}>
            <span className={s.tileLabel}>Продажи за {month}</span>
            <b>{formatRub(counters.salesMonth)}</b>
            <span className={`${s.tileHint} ${s.tileOk}`}>выплаты напрямую, комиссия {me.supplier.commissionBp / 100}%</span>
          </Link>
        )}
      </div>

      {canCatalog && (
        <section className={`${s.panel} ${s.panelPad}`} style={{ marginBottom: 40 }}>
          <div className={s.panelHead}>
            <h2>Импорт каталога</h2>
            <Link href="/supplier/import" className={s.link}>
              Все источники →
            </Link>
          </div>
          <div className={s.importBox}>
            <FileIcon />
            {last ? (
              <div className={s.importText}>
                <b>
                  {last.fileName ?? 'YML-фид'} · {IMPORT_STATUS[last.status] ?? last.status}
                </b>
                <span>
                  {last.totalRows} строк: {last.newProducts} новых · {last.updates} обновлений ·{' '}
                  <span style={{ color: last.errorRows ? 'var(--c-sale)' : undefined }}>{last.errorRows} с ошибками</span>
                </span>
              </div>
            ) : (
              <div className={s.importText}>
                <b>Импортов ещё не было</b>
                <span>Загрузите таблицу по шаблону или подключите YML-фид из 1С / МоегоСклада.</span>
              </div>
            )}
            <ButtonLink href="/supplier/import" variant="outline">
              {last ? 'Загрузить ещё файл' : 'Загрузить файл'}
            </ButtonLink>
          </div>
        </section>
      )}

      {canOrders && <ActionOrders />}
    </>
  );
}
