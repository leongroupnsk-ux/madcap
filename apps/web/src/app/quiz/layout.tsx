import type { Metadata } from 'next';
import { Metrika } from '@/components/Metrika';
import s from '@/components/quiz/quiz.module.css';

export const metadata: Metadata = { title: 'Анкета подбора', robots: { index: false } };

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  // main — ориентир для скринридеров (axe: landmark-one-main)
  return (
    <>
      <main className={s.page}>{children}</main>
      <Metrika />
    </>
  );
}
