// Настройки Prisma CLI (вместо устаревшего package.json#prisma, который уходит в Prisma 7).
// При наличии этого файла Prisma сама .env не читает — подгружаем его здесь. В контейнере файла .env нет,
// DATABASE_URL приходит из окружения, и dotenv просто ничего не делает (переменные окружения он не перезаписывает).
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
