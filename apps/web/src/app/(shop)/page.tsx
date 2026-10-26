import { DEFAULT_STOREFRONT, type StorefrontSettings } from '@aesculap/shared';
import Link from 'next/link';
import { ProductGrid } from '@/components/shop/ProductCard';
import h from '@/components/shop/home.module.css';
import s from '@/components/shop/shop.module.css';
import { playfair, playfairFaces } from '@/fonts/playfair';
import type { Card } from '@/lib/catalog';
import { serverApi } from '@/lib/server-api';

// Playfair Display — шрифт премиум-баннера; подключён здесь, чтобы предзагружаться только на главной (fonts/playfair.ts)
void playfairFaces;

export const revalidate = 300;

const BENEFITS = [
  ['truck', 'СДЭК: пункт выдачи или курьером, 2–4 дня'],
  ['card', 'Оплата картой или СБП, чек на почту'],
  ['return', 'Возврат в течение 7 дней'],
  ['team', 'Совместные закупки для отделений — скоро'],
] as const;

const STEPS = [
  ['clipboard-check', '01 - Заполните анкету', 'Укажите свои размеры, стиль и бюджет. Это займет 5 минут.'],
  ['ruler', '02 - Мы подберём вещи', 'Соберем капсулу из 5 вещей по вашим предпочтениям.'],
  ['shirt', '03 - Вы получите готовую капсулу', 'Индивидуально подобранный комплект, который можно заказать.'],
] as const;

/** Как в макете: слово перед выделенным начинает новую строку («Рабочая капсула / под Вашу …») */
function HeroBefore({ text }: { text: string }) {
  const m = /^(.*\S)\s+(\S+\s*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <br />
      {m[2]}
    </>
  );
}

/** Главная — кадр .Main макета: баннеры, хиты, преимущества, «Как это работает», подборка, призыв. */
export default async function HomePage() {
  const [homeRes, picksRes] = await Promise.all([
    serverApi<{
      hits: Card[];
      promotions: { name: string; badge: string; description: string; endsAt: string; items: Card[] }[];
      hero: StorefrontSettings['hero'];
      premium: StorefrontSettings['premium'];
      capsuleOfWeek: { title: string; text: string; items: Card[] } | null;
    }>('/catalog/home'),
    // «Подобрано для вас»: каталог по умолчанию с отметкой «Подходит вам» по профилю
    serverApi<{ items: Card[] }>('/catalog/products?perPage=10'),
  ]);
  const home = homeRes.data;
  const hero = home?.hero ?? DEFAULT_STOREFRONT.hero;
  const premium = home?.premium ?? DEFAULT_STOREFRONT.premium;
  const [before, after] = hero.accent && hero.title.includes(hero.accent) ? hero.title.split(hero.accent, 2) : [hero.title, null];
  // «Больше, чем униформа»: вторая часть заголовка — вторым цветом, как в макете
  const comma = premium.title.indexOf(',');
  const hits = home?.hits ?? [];
  const picks = picksRes.data?.items ?? [];
  return (
    <>
      <div className="container">
        <div className={h.banner}>
          <section className={h.hero}>
            {/* LCP главной: высокий приоритет и уменьшенные копии для телефонов (docs/PERF.md) */}
            <img
              className={h.heroImg}
              src="/design/hero.webp"
              srcSet="/design/hero-768.webp 768w, /design/hero-1024.webp 1024w, /design/hero.webp 1536w"
              sizes="(max-width: 900px) 100vw, 840px"
              alt=""
              fetchPriority="high"
            />
            <div className={h.heroText}>
              {hero.eyebrow && <div className="eyebrow">{hero.eyebrow}</div>}
              <h1>
                {after !== null ? <HeroBefore text={before} /> : before}
                {after !== null && (
                  <>
                    <em>{hero.accent}</em>
                    {after}
                  </>
                )}
              </h1>
              {hero.text && <p>{hero.text}</p>}
            </div>
            <div className={h.heroCta}>
              <Link href="/quiz/1" className={h.btnAccent}>
                {hero.cta}
              </Link>
              <Link href="/how" className={h.btnGhost}>
                Как это работает
              </Link>
            </div>
          </section>
          <section className={`${h.premium} ${playfair.variable}`}>
            <img
              className={h.premiumImg}
              src="/design/premium-banner.webp"
              srcSet="/design/premium-banner-640.webp 640w, /design/premium-banner.webp 1100w"
              sizes="(max-width: 900px) 100vw, 490px"
              alt=""
            />
            <span className={h.mark}>
              aesculap<span>. </span>
              <small>premium</small>
            </span>
            <h2>
              {comma > 0 ? (
                <>
                  {premium.title.slice(0, comma + 1)}
                  <span>{premium.title.slice(comma + 1).trim()}</span>
                </>
              ) : (
                premium.title
              )}
            </h2>
            {premium.text && <p>{premium.text}</p>}
            <Link href="/premium" className={h.premiumBtn}>
              {premium.cta}
            </Link>
          </section>
        </div>
      </div>

      {hits.length > 0 && (
        <section className={`container ${h.section}`}>
          <div className={s.sectionHead}>
            <h2>Хиты недели</h2>
            <Link href="/catalog" className={s.more}>
              Все товары →
            </Link>
          </div>
          <ProductGrid items={hits.slice(0, 5)} />
        </section>
      )}

      {/* Акции и «Капсула недели» включаются в админке; в макете их нет */}
      {(home?.promotions ?? []).map((pr) => (
        <section key={pr.name} className={`container ${h.section}`} style={{ paddingTop: 0 }}>
          <div className={s.sectionHead}>
            <h2>{pr.name}</h2>
            <Link href="/catalog?sale=1" className={s.more}>
              Все акции →
            </Link>
          </div>
          <ProductGrid items={pr.items.slice(0, 5)} />
        </section>
      ))}
      {home?.capsuleOfWeek && (
        <section className={`container ${h.section}`} style={{ paddingTop: 0 }}>
          <div className={s.sectionHead}>
            <h2>{home.capsuleOfWeek.title || 'Капсула недели'}</h2>
            <Link href="/quiz/1" className={s.more}>
              Подобрать свою →
            </Link>
          </div>
          <ProductGrid items={home.capsuleOfWeek.items} />
        </section>
      )}

      <div className="container">
        <div className={h.benefits}>
          {BENEFITS.map(([icon, text]) => (
            <div key={icon} className={h.benefit}>
              <img src={`/design/icons/${icon}.svg`} alt="" width={28} height={28} />
              <span>{text}</span>
            </div>
          ))}
        </div>

        <section id="how" className={h.how} aria-label="Как это работает">
          <div className="eyebrow">Персональный подбор</div>
          <h2>
            Ваш гардероб начинается с <span>Вас</span>
          </h2>
          <div className={h.steps}>
            {STEPS.map(([icon, title, text]) => (
              <div key={icon} className={h.step}>
                <img src={`/design/icons/${icon}.svg`} alt="" width={40} height={40} />
                <b>{title.toUpperCase()}</b>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <Link href="/quiz/1" className={h.howCta}>
            Подобрать капсулу
          </Link>
        </section>
      </div>

      {picks.length > 0 && (
        <section className={`container ${h.section}`}>
          <div className={s.sectionHead}>
            <h2>Подобрано для вас</h2>
          </div>
          <ProductGrid items={picks} />
        </section>
      )}

      <section className={h.ctaBand}>
        <div className={`container ${h.ctaInner}`}>
          <div>
            <div className="eyebrow">Ваш следующий шаг</div>
            <h2>Подберите гардероб для своей работы</h2>
          </div>
          <Link href="/quiz/1" className={h.ctaBtn}>
            Подобрать капсулу
          </Link>
        </div>
      </section>
    </>
  );
}
