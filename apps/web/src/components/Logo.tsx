import s from './site.module.css';

/** Логотип макета: «aesculap» и терракотовая точка */
export function Logo({ size = 21 }: { size?: number }) {
  return (
    <span className={s.logoMark} style={{ fontSize: size }}>
      aesculap<span className={s.logoDot}>.</span>
    </span>
  );
}
