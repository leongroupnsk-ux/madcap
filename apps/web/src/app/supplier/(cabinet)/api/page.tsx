import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/supplier/cabinet.module.css';
import { requireSupplier } from '@/lib/supplier-session';
import a from './api.module.css';

export const metadata: Metadata = { title: 'API для учётной системы' };

const ENDPOINTS: [string, string, string][] = [
  ['PUT', '/stock', 'Остатки по SKU пачкой до 1000 позиций. Пополнение с нуля — письма «Сообщить о поступлении».'],
  ['PUT', '/prices', 'Цены и зачёркнутые цены по SKU, до 1000 позиций. Акционная цена пересчитывается сама.'],
  ['GET', '/orders?status=new', 'Отправления: action, new, confirmed, packed, handed_over, …, all. До 100 за запрос.'],
  ['POST', '/orders/:id/confirm', 'Подтвердить новое отправление.'],
];

/** Подсказка по партнёрскому API (полная версия — docs/PARTNER_API.md) */
export default async function ApiHelpPage() {
  const me = await requireSupplier();
  if (!me) return null;
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Интеграции</div>
          <h1>API для учётной системы</h1>
          <p className={s.lead}>Остатки, цены и заказы из 1С, МойСклад или своего склада — без выгрузки файлов.</p>
        </div>
      </div>

      <section className={`${s.panel} ${s.panelPad}`} aria-labelledby="api-start">
        <h2 id="api-start" className={a.h2}>
          Как подключить
        </h2>
        <ol className={a.steps}>
          <li>
            {me.role === 'owner' ? (
              <>
                Создайте ключ в{' '}
                <Link href="/supplier/settings#api-keys-title" className={s.link}>
                  «Настройки → Ключи API»
                </Link>
              </>
            ) : (
              'Попросите владельца кабинета создать ключ в «Настройки → Ключи API»'
            )}
            . Ключ показывается один раз — сохраните его в учётной системе, не в браузере.
          </li>
          <li>
            Передавайте его в заголовке <code>Authorization: Bearer ak_…</code> на адрес <code>/api/partner/v1</code> этого сайта.
          </li>
          <li>Цены — в рублях, остатки — целые штуки, формат — JSON. Лимит — 120 запросов в минуту на ключ (сверх — ответ 429 и Retry-After).</li>
        </ol>
      </section>

      <section className={`${s.panel} ${s.panelPad}`} style={{ marginTop: 24 }} aria-labelledby="api-methods">
        <h2 id="api-methods" className={a.h2}>
          Методы
        </h2>
        <div className={`${s.tableCard} ${s.tableCardSm}`}>
          <table className={`${s.table} ${a.table}`}>
            <thead>
              <tr>
                <th scope="col">Метод</th>
                <th scope="col">Адрес</th>
                <th scope="col">Что делает</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([m, path, text]) => (
                <tr key={path}>
                  <td>
                    <span className={a.method}>{m}</span>
                  </td>
                  <td>
                    <code className={a.path}>/api/partner/v1{path}</code>
                  </td>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className={a.h3}>Пример: обновить остатки</h3>
        <pre className={a.code} tabIndex={0} aria-label="Пример запроса">
          {`curl -X PUT ${'https://<сайт>'}/api/partner/v1/stock \\
  -H "Authorization: Bearer $AESCULAP_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[{"sku":"MT-1101-M","stock":12},{"sku":"MT-1101-L","stock":0}]}'

→ {"received":2,"updated":1,"unchanged":1,"notFound":[]}`}
        </pre>
        <p className={s.muted}>
          Ключ видит только ваш кабинет: чужие SKU попадут в notFound, чужие отправления — 404. Все изменения через API — в журнале действий. Телефон и email покупателя через API не
          передаются.
        </p>
      </section>
    </>
  );
}
