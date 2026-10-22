import Link from 'next/link';
import { ProductGrid } from '@/components/shop/ProductCard';
import h from '@/components/shop/home.module.css';
import s from '@/components/shop/shop.module.css';
import { ButtonLink } from '@/components/ui';
import { BRAND } from '@/lib/brand';
import type { Card } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

export const revalidate = 300;

export default async function HomePage() {
  const hits = (await serverApi<{ hits: Card[] }>('/catalog/home')).data?.hits ?? [];
  const collage = hits.filter((p) => p.images[0]).slice(0, 3);
  return (
    <>
      <div className="container">
        <div className={h.heroRow}>
          <section className={h.hero}>
            <div className={h.heroText}>
              <div className="eyebrow">Персональный подбор</div>
              <h1>
                Рабочая капсула под <em>Вашу</em> специальность
              </h1>
              <p>Анкета за 5 минут: специальность, размеры и рост, дресс-код клиники и бюджет. Соберём комплект формы из 5 вещей.</p>
              <div className={h.heroCta}>
                <ButtonLink href="/quiz/1" variant="accent">
                  Подобрать капсулу
                </ButtonLink>
                <ButtonLink href="/#how" variant="outline">
                  Как это работает
                </ButtonLink>
              </div>
            </div>
            <div className={h.collage} aria-hidden>
              {collage.map((p) => (
                <img key={p.id} src={p.images[0]!} alt="" />
              ))}
            </div>
          </section>
          <section className={h.premium}>
            <span className={h.mark}>{BRAND.mark} premium</span>
            <h2>Больше, чем униформа</h2>
            <p>Продуманный дизайн, исключительный комфорт. Создано для тех, кто меняет мир к лучшему.</p>
            <Link href="/premium" className={h.premiumBtn}>
              Премиум коллекция
            </Link>
          </section>
        </div>

        {hits.length > 0 && (
          <>
            <div className={s.sectionHead}>
              <h2>Хиты недели</h2>
              <Link href="/catalog" className={s.more}>
                Все товары →
              </Link>
            </div>
            <ProductGrid items={hits.slice(0, 10)} />
          </>
        )}

        <div className={h.benefits}>
          <div className={h.benefit}>
            <span>🚚</span>
            <span>СДЭК: пункт выдачи или курьером, 2–4 дня</span>
          </div>
          <div className={h.benefit}>
            <span>💳</span>
            <span>Оплата картой или СБП, чек на почту</span>
          </div>
          <div className={h.benefit}>
            <span>↺</span>
            <span>Возврат в течение 7 дней</span>
          </div>
          <div className={h.benefit}>
            <span>👥</span>
            <span>Совместные закупки для отделений — скоро</span>
          </div>
        </div>

        <section id="how" className={h.how} aria-label="Как это работает">
          <div className={h.step}>
            <b>01</b>
            <h3>Анкета за 5 минут</h3>
            <p>Специальность, рост и размеры, цветотип и бюджет. Можно добавить фото — подберём точнее.</p>
          </div>
          <div className={h.step}>
            <b>02</b>
            <h3>Капсула из 5 вещей</h3>
            <p>Топ, брюки, халат, обувь и аксессуар — в вашем размере, в наличии и в рамках бюджета.</p>
          </div>
          <div className={h.step}>
            <b>03</b>
            <h3>Один заказ — разные бренды</h3>
            <p>Каждый поставщик отправляет со своего склада через СДЭК, а оплата одна.</p>
          </div>
        </section>
      </div>

      <section className={h.ctaBand}>
        <div className={`container ${h.ctaInner}`}>
          <div>
            <div className="eyebrow">Ваш следующий шаг</div>
            <h2>Подберите гардероб для своей работы</h2>
          </div>
          <ButtonLink href="/quiz/1">Подобрать капсулу</ButtonLink>
        </div>
      </section>
    </>
  );
}
