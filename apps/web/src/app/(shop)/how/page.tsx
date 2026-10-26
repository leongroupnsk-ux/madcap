import { BUDGETS, HEIGHT_RANGES, SIZES } from '@aesculap/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import h from '@/components/shop/home.module.css';
import { SITE_URL } from '@/lib/catalog';
import w from './how.module.css';

export const metadata: Metadata = {
  title: 'Как это работает',
  description: 'Как aesculap подбирает рабочую капсулу по анкете и как устроен заказ у нескольких поставщиков: одна оплата, доставка СДЭК, возврат 7 дней.',
  alternates: { canonical: `${SITE_URL}/how` },
};

// Тексты — по фактам из кода: анкета (components/quiz), движок капсулы (apps/api/src/me/capsule.service.ts),
// оформление и «Доставка и возврат» (lib/legal.tsx). Сроков и цен доставки здесь нет — они считаются при оформлении.

const STEPS = [
  ['clipboard-check', '01 - Заполните анкету', 'Шесть коротких шагов: для кого подбираем, параметры, цветотип, специальность, бюджет и по желанию фото. Ответы сохраняются после каждого шага.'],
  ['ruler', '02 - Мы соберём капсулу', 'Топ, брюки, халат, обувь и аксессуар — только из того, что есть в наличии в вашем размере и ростовке. До трёх вариантов в разных цветах.'],
  ['shirt', '03 - Закажите комплект', 'Любую вещь можно заменить на альтернативу, а капсулу — положить в корзину целиком и оформить одним заказом.'],
] as const;

const BUDGET_RANGE = `от «${BUDGETS[0].label}» до «${BUDGETS[BUDGETS.length - 1].label}»`;

const FACTORS = [
  ['quiz-scissors', 'Специальность', 'От неё зависят требования к ткани, крою и обработке. Можно выбрать несколько специальностей — вещи для них поднимаются выше.'],
  ['quiz-shirt', 'Размер и ростовка', `Размеры ${SIZES[0]}–${SIZES[SIZES.length - 1]} отдельно для верха и низа, размер обуви и рост: ростовки ${HEIGHT_RANGES[0]} … ${HEIGHT_RANGES[HEIGHT_RANGES.length - 1]} см. Вещи не в наличии в вашем размере в капсулу не попадают.`],
  ['quiz-sun', 'Цветотип', 'Несколько простых вопросов определяют цветотип — подбор отдаёт предпочтение подходящей палитре. Шаг можно пропустить.'],
  ['card', 'Бюджет', `Бюджет на всю капсулу — один из диапазонов ${BUDGET_RANGE}. Если комплект не помещается, дорогие вещи меняются на более доступные, а необязательные — аксессуар, обувь, халат — убираются.`],
] as const;

const ORDER = [
  ['Одна корзина', 'Товары разных поставщиков лежат в одной корзине — вместе с капсулой или по отдельности.'],
  ['Одна оплата', 'Картой или через СБП на защищённой странице ЮKassa, чек приходит на почту.'],
  ['Отправления по поставщикам', 'Каждый поставщик отправляет свою часть со своего склада, поэтому посылок может быть несколько. Статус и трек каждой — в профиле, в карточке заказа.'],
  ['Доставка СДЭК', 'Пункт выдачи или курьер — выбираются для каждого отправления; срок и цена считаются при оформлении.'],
  ['Возврат 7 дней', 'После получения: «Профиль → Заказ → Оформить возврат». Отменить отправление можно до передачи в доставку — деньги вернутся полностью.'],
] as const;

const FAQ: [string, React.ReactNode][] = [
  [
    'Нужно ли регистрироваться, чтобы пройти анкету?',
    'Нет: ответы гостя сохраняются в браузере. Чтобы собрать капсулу и сохранить профиль, нужен аккаунт — ответы перенесутся в него автоматически.',
  ],
  [
    'Обязательно загружать фото?',
    <>
      Нет, шаг с фото можно пропустить. Фото видите только вы, поставщикам они не передаются, метаданные (EXIF, геометки) удаляются при загрузке. Отозвать согласие и удалить фото можно в профиле —{' '}
      <Link href="/legal/photos">подробнее</Link>.
    </>,
  ],
  ['Можно заменить вещь в капсуле?', 'Да: у каждой вещи есть «Заменить» со списком альтернатив. Ваш выбор закрепляется и сохраняется, даже если капсула пересоберётся.'],
  ['Изменился размер или бюджет — что делать?', 'Обновите анкету в профиле: капсула пересоберётся по новым ответам.'],
  ['Почему заказ пришёл несколькими посылками?', 'Вещи в заказе могут быть от разных поставщиков, и каждый отправляет свою часть со своего склада. Платите вы один раз за весь заказ.'],
  [
    'Как вернуть товар?',
    <>
      В течение 7 дней после получения: «Профиль → Заказ → Оформить возврат». После одобрения поставщиком деньги за товары вернутся на карту или счёт СБП.{' '}
      <Link href="/legal/delivery">Доставка и возврат</Link>.
    </>,
  ],
  [
    'Что такое «Премиум»?',
    <>
      Отдельная премиум-коллекция со своей анкетой. Онлайн-оплаты в ней нет: вы оставляете заявку, и с вами связывается менеджер. <Link href="/premium">Перейти в премиум</Link>.
    </>,
  ],
];

/** «Как это работает» — макета нет (ТЗ §12 п.17); стиль главной: блок шагов, мятные плашки, полоса призыва. */
export default function HowPage() {
  return (
    <>
      <div className="container">
        <section className={w.intro}>
          <div className="eyebrow">Как это работает</div>
          <h1>
            Рабочая форма, подобранная <em>под Вас</em>
          </h1>
          <p>Маркетплейс медицинской одежды: вещи разных поставщиков в одном каталоге, подбор капсулы по анкете и один заказ с одной оплатой.</p>
          <div className={w.introCta}>
            <Link href="/quiz/1" className={h.btnAccent}>
              Подобрать капсулу
            </Link>
            <Link href="/catalog" className={h.btnGhost}>
              Смотреть каталог
            </Link>
          </div>
        </section>

        <section className={h.how} aria-labelledby="how-steps">
          <div className="eyebrow">Персональный подбор</div>
          <h2 id="how-steps">
            Ваш гардероб начинается с <span>Вас</span>
          </h2>
          <ol className={`${h.steps} ${w.steps}`}>
            {STEPS.map(([icon, title, text]) => (
              <li key={icon} className={h.step}>
                <img src={`/design/icons/${icon}.svg`} alt="" width={40} height={40} />
                <b>{title.toUpperCase()}</b>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <Link href="/quiz/1" className={h.howCta}>
            Подобрать капсулу
          </Link>
        </section>

        <section className={w.section} aria-labelledby="how-factors">
          <div className="eyebrow">Что учитывает подбор</div>
          <h2 id="how-factors">Четыре вещи, которые важны</h2>
          <ul className={w.factors}>
            {FACTORS.map(([icon, title, text]) => (
              <li key={title} className={w.factor}>
                <img src={`/design/icons/${icon}.svg`} alt="" width={28} height={28} />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={w.section} aria-labelledby="how-order">
          <div className="eyebrow">Заказ</div>
          <h2 id="how-order">Несколько поставщиков — один заказ</h2>
          <ol className={w.order}>
            {ORDER.map(([title, text], i) => (
              <li key={title}>
                <span className={w.orderNo} aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={w.section} aria-labelledby="how-faq">
          <div className="eyebrow">Вопросы и ответы</div>
          <h2 id="how-faq">Частые вопросы</h2>
          <div className={w.faq}>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

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
