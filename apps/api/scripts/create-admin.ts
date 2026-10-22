/**
 * Создание/повышение администратора: pnpm --filter @aesculap/api admin:create email@example.ru
 * Пароль печатается один раз; сменить — через «Забыли пароль?».
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Укажите email: admin:create admin@example.ru');
  process.exit(1);
}

const prisma = new PrismaClient();
(async () => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    console.log(`${email}: роль изменена на admin, пароль прежний.`);
  } else {
    const password = randomBytes(12).toString('base64url');
    await prisma.user.create({ data: { email, role: 'admin', emailVerifiedAt: new Date(), passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } });
    console.log(`Создан админ ${email}. Временный пароль: ${password}`);
  }
  await prisma.$disconnect();
})();
