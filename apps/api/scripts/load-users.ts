/**
 * Тестовые покупатели для нагрузочного теста сайта (ops/load-site.mjs, docs/LOAD.md): пользователи с входом
 * (сессия создаётся прямо в базе — вход через форму упёрся бы в лимиты и капчу) и без анкеты — её проходит сам тест.
 *
 *   DATABASE_URL=…/aesculap_load pnpm --filter @aesculap/api exec tsx scripts/load-users.ts 50 > load-users.json
 *   DATABASE_URL=…/aesculap_load pnpm --filter @aesculap/api exec tsx scripts/load-users.ts --clean
 *
 * На сервере перед пилотом (база потом сбрасывается): LOAD_USERS_ALLOW=1 docker compose … exec -T api npx tsx
 * scripts/load-users.ts 50 > load-users.json; после теста — то же с --clean. Адреса @load.test, вход только по cookie
 * из файла: пароля у них нет.
 */
import { PrismaClient } from '@prisma/client';
import { newToken, sha256 } from '../src/common/crypto';

const DOMAIN = '@load.test';
const prisma = new PrismaClient();

async function main() {
  if (!(process.env.DATABASE_URL ?? '').includes('_load') && process.env.LOAD_USERS_ALLOW !== '1') {
    console.error('Только на базе *_load или с LOAD_USERS_ALLOW=1 (боевой сервер до пилота)');
    process.exit(1);
  }
  const old = await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  if (process.argv.includes('--clean')) {
    console.error(`Удалено тестовых покупателей: ${old.count}`);
    return;
  }
  const n = Math.min(500, Math.max(1, Number(process.argv[2]) || 50));
  const specialties = await prisma.specialty.findMany({ select: { id: true } });
  const expiresAt = new Date(Date.now() + 2 * 86_400_000);
  const sessions: string[] = [];
  for (let i = 0; i < n; i++) {
    const token = newToken();
    await prisma.user.create({
      data: {
        email: `buyer${i + 1}${DOMAIN}`, passwordHash: '!', emailVerifiedAt: new Date(),
        sessions: { create: { tokenHash: sha256(token), expiresAt, userAgent: 'load-test' } },
      },
    });
    sessions.push(token);
  }
  // Значения cookie — только в stdout (в файл, который удаляется после теста), в лог не пишутся
  process.stdout.write(JSON.stringify({ sessions, specialtyIds: specialties.map((s) => s.id) }));
  console.error(`Создано тестовых покупателей: ${n} (сессии на 2 дня). Удалить: scripts/load-users.ts --clean`);
}

main().finally(() => prisma.$disconnect());
