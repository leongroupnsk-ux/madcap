/**
 * Приёмка подбора (ТЗ §13, этап 3): 20 тестовых анкет дают капсулы в бюджете и размере, сборка ≤ 2 с.
 * На нагрузочной базе (50 000 вариантов): DATABASE_URL=…/aesculap_load pnpm --filter @aesculap/api capsule:bench
 */
import { BUDGETS, type ProfileUpdate } from '@aesculap/shared';
import { PrismaClient } from '@prisma/client';
import { CapsuleService } from '../src/me/capsule.service';

const prisma = new PrismaClient();
if (!(process.env.DATABASE_URL ?? '').includes('_load')) {
  console.error('Только на базе *_load');
  process.exit(1);
}
const svc = new CapsuleService(prisma as never, { publicUrl: (k: string | null) => k } as never);

const TOPS = ['XS', 'S', 'M', 'L', 'XL'];
const SHOES = ['36', '37', '38', '39', '40', '41', '42', '43'];

async function main() {
  const specialties = await prisma.specialty.findMany();
  await prisma.user.deleteMany({ where: { email: { endsWith: '@bench.local' } } });
  const rows: string[] = [];
  let fails = 0;
  for (let i = 0; i < 20; i++) {
    const budget = BUDGETS[i % BUDGETS.length];
    const p: ProfileUpdate = {
      gender: i % 3 === 0 ? 'male' : 'female', name: `Тест ${i}`, age: 25 + i, heightCm: 160 + (i % 5) * 6, weightKg: 55 + i,
      sizeTop: TOPS[i % 5], sizeBottom: TOPS[(i + 1) % 5], sizeShoes: SHOES[i % 8], skinTone: i % 2 ? 'warm' : 'cold', hair: i % 4 < 2 ? 'light' : 'dark', eyes: 'light',
      budgetRange: budget.id,
    } as ProfileUpdate;
    const user = await prisma.user.create({ data: { email: `u${i}@bench.local`, passwordHash: 'x', emailVerifiedAt: new Date() } });
    await prisma.buyerProfile.create({
      data: { userId: user.id, ...(p as object), quizCompletedAt: new Date(), specialties: { create: [{ specialtyId: specialties[i % specialties.length].id }] } } as never,
    });
    const t = Date.now();
    await svc.build(user.id);
    const ms = Date.now() - t;
    const cap = await svc.get(user, 1);
    const items = cap.items.filter((x) => x.variant);
    const budgetMax = budget.max ? budget.max * 100 : Infinity;
    const sizeOk = items.every((x) => (x.slot === 'shoes' ? x.variant!.size === p.sizeShoes : x.slot === 'pants' ? x.variant!.size === p.sizeBottom : x.slot === 'accessory' || x.variant!.size === p.sizeTop));
    const ok = ms <= 2000 && cap.total <= budgetMax && sizeOk && items.length >= 2;
    if (!ok) fails++;
    rows.push(`${ok ? '✓' : '✗'} анкета ${String(i + 1).padStart(2)} · ${budget.label.padEnd(16)} · ${items.length} вещей · ${(cap.total / 100).toLocaleString('ru-RU')} ₽ · размеры ${sizeOk ? 'ок' : 'НЕ ТЕ'} · ${ms} мс`);
    console.log(rows.at(-1));
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: '@bench.local' } } });
  console.log(`\nИтого: ${20 - fails} из 20 анкет в норме.`);
  await prisma.$disconnect();
}

void main();
