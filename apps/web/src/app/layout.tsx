import type { Metadata } from 'next';
import { fontFaces, fontVariables } from '@/fonts';
import { BRAND } from '@/lib/brand';
import './globals.css';

// Шрифты макета — локальные файлы (src/fonts): Prata, Playfair Display, Manrope, JetBrains Mono
void fontFaces;

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — медицинская одежда и рабочая капсула`, template: `%s — ${BRAND.name}` },
  description: 'Маркетплейс медицинской одежды: персональная капсула формы под специальность, размеры и бюджет.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
