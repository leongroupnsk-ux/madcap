import type { Metadata } from 'next';
import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import s from './map.module.css';

export const metadata: Metadata = { title: 'Карта платформы', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Item = { label: string; href: string; hint?: string };
type Section = { title: string; tags: string; items: Item[] };

/** Первый элемент списка из API или null — для пунктов-примеров («Статья», «Детали заказа» и т. п.). */
async function first<T>(path: string, pick: (d: unknown) => T | undefined): Promise<T | null> {
  const { data } = await serverApi<unknown>(path);
  return data == null ? null : (pick(data) ?? null);
}
const arr = (d: unknown) => (Array.isArray(d) ? d : Array.isArray((d as { items?: unknown[] })?.items) ? (d as { items: unknown[] }).items : []);

/**
 * Карта платформы — кадр Sitemap: разделы и ссылки на реальные страницы.
 * Страницы конкретной записи (товар, статья, заказ) ведут на первую доступную запись;
 * если её нет (нет данных или сессии), — на список этого раздела, чтобы не было битых ссылок.
 */
export default async function MapPage() {
  const [product, journal, order, sProduct, sOrder, sContent] = await Promise.all([
    first('/catalog/products?perPage=1', (d) => (arr(d)[0] as { slug?: string })?.slug),
    first('/journal', (d) => arr(d) as { kind: string; slug: string }[]),
    first('/orders', (d) => (arr(d)[0] as { number?: string })?.number),
    first('/supplier/products?perPage=1', (d) => (arr(d)[0] as { id?: string })?.id),
    first('/supplier/orders?status=all', (d) => (arr(d)[0] as { id?: string })?.id),
    first('/supplier/content', (d) => arr(d) as { kind: string; id: string }[]),
  ]);
  const article = journal?.find((j) => j.kind === 'article')?.slug;
  const collection = journal?.find((j) => j.kind === 'collection')?.slug;
  const sArticle = sContent?.find((c) => c.kind === 'article')?.id;
  const sCollection = sContent?.find((c) => c.kind === 'collection')?.id;

  const sections: Section[] = [
    {
      title: 'Покупатель: витрина и подбор',
      tags: 'auth · catalog · capsule',
      items: [
        { label: 'Главная', href: '/' },
        { label: 'Как это работает', href: '/how' },
        { label: 'Регистрация', href: '/register' },
        { label: 'Авторизация', href: '/login' },
        { label: 'Восстановление пароля', href: '/reset-password' },
        { label: 'Каталог', href: '/catalog' },
        { label: 'Карточка товара', href: product ? `/product/${product}` : '/catalog' },
        { label: 'Анкета (подбор)', href: '/quiz/1' },
        { label: 'Капсула', href: '/capsule' },
        { label: 'Журнал (контент)', href: '/journal' },
        { label: 'Статья', href: article ? `/journal/${article}` : '/journal' },
        { label: 'Подборка одежды', href: collection ? `/collections/${collection}` : '/journal' },
      ],
    },
    {
      title: 'Покупатель: деньги и доставка',
      tags: 'cart · checkout · payments · delivery · orders',
      items: [
        { label: 'Корзина', href: '/cart' },
        // Пустая корзина — состояние той же страницы, отдельного адреса нет
        { label: 'Корзина пустая', href: '/cart', hint: 'Та же страница корзины без товаров' },
        { label: 'Оформление заказа', href: '/checkout' },
        // Оплата открывается из оформления заказа — у неё нет постоянного адреса
        { label: 'Оплата', href: '/checkout', hint: 'Оплата запускается на последнем шаге оформления' },
        { label: 'Успех', href: order ? `/orders/${order}/result` : '/account', hint: order ? undefined : 'Появится после первого заказа' },
        { label: 'Профиль (анкета, заказы)', href: '/account' },
        { label: 'Детали заказа', href: order ? `/account/orders/${order}` : '/account', hint: order ? undefined : 'Появится после первого заказа' },
      ],
    },
    {
      title: 'Поставщик',
      tags: 'supplier · imports · content · payments · notifications',
      items: [
        { label: 'Авторизация поставщика', href: '/supplier/login' },
        { label: 'Заявка поставщика', href: '/supplier/apply' },
        { label: 'Дашборд', href: '/supplier' },
        { label: 'Товары', href: '/supplier/products' },
        { label: 'Новый товар', href: '/supplier/products/new' },
        { label: 'Карточка товара', href: sProduct ? `/supplier/products/${sProduct}` : '/supplier/products' },
        { label: 'Импорт CSV', href: '/supplier/import' },
        { label: 'Заказы поставщика', href: '/supplier/orders' },
        { label: 'Заказ поставщика', href: sOrder ? `/supplier/orders/${sOrder}` : '/supplier/orders' },
        { label: 'Контент', href: '/supplier/content' },
        { label: 'Новая статья', href: '/supplier/content/articles/new' },
        { label: 'Статья', href: sArticle ? `/supplier/content/articles/${sArticle}` : '/supplier/content' },
        { label: 'Новая подборка', href: '/supplier/content/collections/new' },
        { label: 'Подборка', href: sCollection ? `/supplier/content/collections/${sCollection}` : '/supplier/content' },
        { label: 'Акции', href: '/supplier/promotions' },
        { label: 'Выплаты', href: '/supplier/payouts' },
        { label: 'Настройки', href: '/supplier/settings' },
      ],
    },
  ];

  return (
    <div className={s.page}>
      <h1 className={s.title}>Карта платформы</h1>
      {sections.map((sec, i) => (
        <section key={sec.title} className={s.section} aria-labelledby={`map-${i}`}>
          <div className={s.head}>
            <h2 id={`map-${i}`}>{sec.title}</h2>
            <p>{sec.tags}</p>
          </div>
          <hr className={s.divider} />
          <ul className={s.links}>
            {sec.items.map((it) => (
              <li key={it.label}>
                <Link href={it.href} className={s.link} title={it.hint} prefetch={false}>
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
