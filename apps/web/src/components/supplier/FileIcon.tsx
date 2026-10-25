import s from './cabinet.module.css';

/** Иконка «документ» 24×24 из макета (File Icon): контур листа, загиб и три строки. */
export function FileIcon({ muted }: { muted?: boolean }) {
  return (
    <svg className={`${s.fileIcon} ${muted ? s.fileIconMuted : ''}`} width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.75" y="1.75" width="16.5" height="20.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="16.75" y="1.75" width="3.5" height="3.5" stroke="currentColor" strokeWidth="1.5" />
      <g fill="currentColor" opacity="0.6">
        <rect x="7" y="10" width="10" height="1.5" rx="0.75" />
        <rect x="7" y="14" width="10" height="1.5" rx="0.75" />
        <rect x="7" y="18" width="8" height="1.5" rx="0.75" />
      </g>
    </svg>
  );
}
