// Запуск e2e: подставляет пароль демо-поставщика из apps/api/prisma/demo.ts (если не задан E2E_DEMO_PASSWORD)
// и передаёт аргументы в `playwright test`. Пароль не печатается.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.E2E_DEMO_PASSWORD) {
  const demo = readFileSync(join(here, '../api/prisma/demo.ts'), 'utf8');
  const m = demo.match(/DEMO_PASSWORD\s*=\s*process\.env\.DEMO_PASSWORD\s*\?\?\s*'([^']+)'/);
  const password = process.env.DEMO_PASSWORD ?? m?.[1];
  if (!password) {
    console.error('Не нашли DEMO_PASSWORD в apps/api/prisma/demo.ts — задайте E2E_DEMO_PASSWORD');
    process.exit(1);
  }
  process.env.E2E_DEMO_PASSWORD = password;
}

const r = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { cwd: here, stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
