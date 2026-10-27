import { Metrika } from '@/components/Metrika';
import s from '@/components/premium/premium.module.css';
import { playfair, playfairFaces } from '@/fonts/playfair';

// Playfair Display — шрифт премиум-раздела, предзагружается только здесь и на главной
void playfairFaces;

/** Премиум-раздел: своя тёмная тема, своя шапка и подвал — без основной шапки сайта (кадры .Premium*). */
export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  // main — ориентир для скринридеров (axe: region)
  return (
    <>
      <main className={`${s.root} ${playfair.variable}`}>{children}</main>
      <Metrika />
    </>
  );
}
