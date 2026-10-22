import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import type { Dictionaries } from '@/lib/types';
import { QuizStep } from '@/components/quiz/QuizStep';

export default async function QuizStepPage({ params }: { params: Promise<{ step: string }> }) {
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1 || step > 6) notFound();
  const dict = step === 4 ? (await serverApi<Dictionaries>('/dictionaries')).data : null;
  return <QuizStep step={step} groups={dict?.specialtyGroups ?? []} />;
}
