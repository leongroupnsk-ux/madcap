import type { Metadata } from 'next';
import { DM_Mono, Manrope, Playfair_Display, Prata } from 'next/font/google';
import { BRAND } from '@/lib/brand';
import './globals.css';

// Шрифты макета: Prata — заголовки, Manrope — текст, DM Mono — надзаголовки, Playfair Display — блок «Премиум»
const prata = Prata({ weight: '400', subsets: ['latin', 'cyrillic'], variable: '--font-prata', display: 'swap' });
const serif = Playfair_Display({ subsets: ['latin', 'cyrillic'], variable: '--font-playfair', display: 'swap' });
const mono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-dm-mono', display: 'swap' });
const sans = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — медицинская одежда и рабочая капсула`, template: `%s — ${BRAND.name}` },
  description: 'Маркетплейс медицинской одежды: персональная капсула формы под специальность, размеры и бюджет.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${prata.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
