import type { Metadata } from 'next';
import Link from 'next/link';
import { PremiumLogo } from '@/components/premium/PremiumLogo';
import s from '@/components/premium/premium.module.css';

export const metadata: Metadata = {
  title: 'Премиум-коллекция',
  description: 'Премиальная медицинская одежда: продуманный дизайн, исключительный комфорт и персональная капсула с менеджером.',
};

const FEATURES = [
  { icon: 'leaf', w: 32, h: 32, text: ['премиум', 'материалы'] },
  { icon: 'wave', w: 48, h: 31, text: ['комфорт', 'на весь день'] },
  { icon: 'diamond', w: 32, h: 32, text: ['современные', 'силуэты'] },
];

/** Лендинг премиум-коллекции (кадр .Premium 212:2806) */
export default function PremiumLanding() {
  return (
    <section className={s.hero}>
      <img className={s.heroImg} src="/design/premium/hero.webp" alt="" fetchPriority="high" />
      <div className={`${s.container} ${s.heroInner}`}>
        <div>
          <PremiumLogo />
        </div>
        <div className={s.backRow}>
          <Link href="/" className={s.monoLink}>
            ←Назад на сайт
          </Link>
        </div>
        <div className={s.heroText}>
          <div>
            <p className={s.heroEyebrow}>Премиальная медицинская одежда</p>
            <h1 className={s.heroTitle}>
              <span>Для тех,</span>кому не все равно
            </h1>
          </div>
          <p className={s.heroLead}>Продуманный дизайн. Исключительный комфорт. Создано для тех, кто меняет мир к лучшему.</p>
        </div>
        <div>
          <Link href="/premium/quiz/1" className={s.btn}>
            подобрать капсулу <span className={s.arrow}>→</span>
          </Link>
        </div>
        <div className={s.features}>
          {FEATURES.map((f) => (
            <div key={f.icon} className={s.feature}>
              <img src={`/design/premium/${f.icon}.webp`} width={f.w} height={f.h} alt="" />
              <span>
                {f.text[0]}
                <br />
                {f.text[1]}
              </span>
            </div>
          ))}
        </div>
        <div className={s.heroFoot}>
          <p>
            Забота
            <br />
            тебе к лицу
          </p>
          <p>
            Медицинская одежда
            <br />
            для светлого будущего
          </p>
        </div>
      </div>
    </section>
  );
}
