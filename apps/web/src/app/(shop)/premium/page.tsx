import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductGrid } from '@/components/shop/ProductCard';
import s from '@/components/shop/shop.module.css';
import { ButtonLink } from '@/components/ui';
import { BRAND } from '@/lib/brand';
import type { Card } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';
import p from './premium.module.css';

export const metadata: Metadata = { title: 'Премиум-коллекция', description: 'Премиальная медицинская одежда: ткани, крой по фигуре и консультация стилиста.' };
export const revalidate = 300;

const FEATURES = [
  { title: 'Ткани, которые держат смену', text: 'Мембранные и стрейч-ткани с антибактериальной обработкой: не мнутся за 12 часов и выдерживают стирку при 60°.' },
  { title: 'Посадка по фигуре', text: 'Ростовки от 158 до 188 см и приталенный крой. Размер и рост берём из вашей анкеты — без примерки наугад.' },
  { title: 'Стилист на связи', text: 'Задайте вопрос в профиле: стилист посмотрит анкету и капсулу и подскажет цвет, крой и сочетания.' },
];

// Раздел «Премиум» вне MVP (ТЗ §1, вопрос §14): анонс коллекции и лучшее из текущего каталога.
export default async function PremiumPage() {
  const top = (await serverApi<{ items: Card[] }>('/catalog/products?sort=price_desc&perPage=5')).data?.items ?? [];
  const collage = top.filter((c) => c.images[0]).slice(0, 3);
  return (
    <div className={`container ${p.page}`}>
      <section className={p.hero}>
        <div>
          <span className={p.mark}>{BRAND.mark} premium</span>
          <h1>
            Больше, <em>чем</em> униформа
          </h1>
          <p className={p.lead}>Продуманный дизайн и исключительный комфорт для тех, кто меняет мир к лучшему. Премиальная коллекция готовится к запуску — а пока соберите капсулу из лучшего, что уже есть в каталоге.</p>
          <div className={p.actions}>
            <ButtonLink href="/quiz/1" variant="accent">
              Подобрать капсулу
            </ButtonLink>
            <Link href="/catalog?sort=price_desc" className={p.ghostLink}>
              Смотреть каталог
            </Link>
          </div>
          <span className={p.badge}>Коллекция — скоро</span>
        </div>
        {collage.length > 0 && (
          <div className={p.collage} aria-hidden>
            <div className={p.glow} />
            {collage.map((c) => (
              <Link key={c.id} href={`/product/${c.slug}`} tabIndex={-1}>
                <img src={c.images[0]!} alt="" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className={p.features}>
        {FEATURES.map((f, i) => (
          <div key={f.title} className={p.feature}>
            <span className={p.num}>0{i + 1}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <>
          <div className={s.sectionHead}>
            <h2>Лучшее из каталога</h2>
            <Link href="/catalog?sort=price_desc" className={s.more}>
              Все товары →
            </Link>
          </div>
          <ProductGrid items={top} />
        </>
      )}

      <section className={p.stylist}>
        <div>
          <h2>Не знаете, с чего начать?</h2>
          <p>Пройдите анкету за 5 минут — соберём комплект из 5 вещей под специальность и бюджет, а стилист ответит на вопросы в профиле.</p>
        </div>
        <ButtonLink href="/quiz/1" variant="accent">
          Пройти анкету
        </ButtonLink>
      </section>
    </div>
  );
}
