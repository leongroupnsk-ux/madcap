import r from './reviews.module.css';

/** Звёзды оценки: заполненные и пустые; число — подписью для чтения с экрана */
export function Stars({ value, size = 14, label }: { value: number; size?: number; label?: string }) {
  const full = Math.round(value);
  return (
    <span className={r.stars} role="img" aria-label={label ?? `Оценка ${value.toLocaleString('ru-RU')} из 5`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= full ? r.starOn : r.starOff} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}
