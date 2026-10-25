import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PremiumQuizStep, PremiumReview } from '@/components/premium/PremiumQuizStep';
import s from '@/components/premium/premium.module.css';
import { serverApi } from '@/lib/server-api';
import type { Dictionaries } from '@/lib/types';

export const metadata: Metadata = { title: 'Премиум-анкета', robots: { index: false } };

/** Премиум-анкета: шаги 1–6 и шаг 7 — проверка ответов (кадры .Premium-Quiz-1…7) */
export default async function PremiumQuizPage({ params }: { params: Promise<{ step: string }> }) {
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1 || step > 7) notFound();
  const dict = step === 4 || step === 7 ? (await serverApi<Dictionaries>('/dictionaries')).data : null;
  const groups = dict?.specialtyGroups ?? [];
  return <div className={s.quizBg}>{step === 7 ? <PremiumReview groups={groups} /> : <PremiumQuizStep step={step} groups={groups} />}</div>;
}
