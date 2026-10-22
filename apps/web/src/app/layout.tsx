import type { Metadata } from 'next';
import { Manrope, Playfair_Display } from 'next/font/google';
import { BRAND } from '@/lib/brand';
import './globals.css';

const serif = Playfair_Display({ subsets: ['latin', 'cyrillic'], variable: '--font-playfair', display: 'swap' });
const sans = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — медицинская одежда и рабочая капсула`, template: `%s — ${BRAND.name}` },
  description: 'Маркетплейс медицинской одежды: персональная капсула формы под специальность, размеры и бюджет.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
