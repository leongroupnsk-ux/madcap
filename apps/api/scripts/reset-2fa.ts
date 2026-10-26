/**
 * Сброс двухфакторной защиты, если сотрудник (в том числе владелец) потерял устройство с кодами:
 *   docker compose -f docker-compose.prod.yml exec api npx tsx scripts/reset-2fa.ts владелец@домен
 * Выключает 2FA, закрывает все сессии пользователя и пишет запись auth.2fa.reset в журнал действий.
 * После входа по паролю сотрудник с обязательной 2FA сразу попадёт на страницу её повторной настройки.
 */
import { PrismaClient } from '@prisma/client';
import { resetTwoFactor } from '../src/auth/reset-2fa';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Укажите email: npx tsx scripts/reset-2fa.ts admin@example.ru');
  process.exit(1);
}

const prisma = new PrismaClient();
resetTwoFactor(prisma, email)
  .then((r) => {
    console.log(`${r.email}: 2FA ${r.hadTwoFactor ? 'сброшена' : 'и так была выключена'}, закрыто сессий: ${r.sessionsClosed}. Запись в журнале: auth.2fa.reset.`);
  })
  .catch((e: Error) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
