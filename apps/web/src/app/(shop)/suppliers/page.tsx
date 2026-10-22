import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Поставщикам', description: `Продавайте медодежду медикам напрямую через ${BRAND.name}: выплаты в момент оплаты, импорт из 1С и МоегоСклада, продажи через подбор.` };

export default function SuppliersLanding() {
  const points = [
    ['Деньги сразу вам', 'Оплата делится в момент платежа: ваша выручка минус комиссия — напрямую на счёт, без реестров.'],
    ['Каталог без ручной работы', 'Выгрузка из 1С или МоегоСклада (YML/Excel) — карточки, цены и остатки создаются сами.'],
    ['Продажи через подбор', 'Товары попадают в персональные капсулы медиков — по специальности, размеру и дресс-коду.'],
    ['СДЭК из кабинета', 'Накладные и трекинг — в один клик, со своего склада.'],
  ];
  return (
    <section className="container" style={{ padding: '48px var(--gutter)' }}>
      <div className="eyebrow">Поставщикам</div>
      <h1 style={{ fontSize: 'clamp(36px, 5vw, 56px)', margin: '12px 0 24px', maxWidth: 760 }}>Продавайте медодежду медикам напрямую</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {points.map(([t, d]) => (
          <div key={t} style={{ background: 'var(--c-surface)', borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>{t}</h2>
            <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14 }}>{d}</p>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 24, color: 'var(--c-text-muted)' }}>Комиссия 10% · модерация до 24 часов · подключение выплат за 1–2 рабочих дня.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <ButtonLink href="/supplier/apply">Оставить заявку</ButtonLink>
        <ButtonLink href="/supplier/login" variant="outline">
          Войти в кабинет
        </ButtonLink>
      </div>
    </section>
  );
}
