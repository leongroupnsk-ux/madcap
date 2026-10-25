import Link from 'next/link';
import s from './premium.module.css';

/** Логотип премиум-раздела «aesculap. premium» (Prata); small — в анкете (20/14 px), иначе 38/22 px. */
export function PremiumLogo({ small, href = '/premium' }: { small?: boolean; href?: string }) {
  return (
    <Link href={href} className={`${s.logo} ${small ? s.logoSm : ''}`} aria-label="aesculap premium — на главную премиум-раздела">
      aesculap<span>. </span>
      <small>premium</small>
    </Link>
  );
}
