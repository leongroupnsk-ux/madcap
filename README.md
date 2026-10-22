# aesculap

Маркетплейс медицинской одежды с подбором рабочей «капсулы». ТЗ: https://claude.ai/artifact/FF7idqVeNunnMJBBTYUgQk · бэклог: [docs/BACKLOG.md](docs/BACKLOG.md).

## Состав

| Пакет | Что это | Порт |
| --- | --- | --- |
| `apps/web` | Next.js 15 (витрина, кабинеты). `/api/*` проксируется в API | 4000 |
| `apps/api` | NestJS 11 + Prisma 6, PostgreSQL, Redis | 4100 |
| `packages/shared` | zod-схемы и енумы, общие для web и api | — |

## Запуск в dev

Нужны Node 22+, pnpm 10, PostgreSQL и Redis на хосте (Docker не используется — на машине мало места).

```bash
pnpm install
cp .env.example .env
psql -d postgres -c "CREATE ROLE aesculap LOGIN PASSWORD 'aesculap' CREATEDB" -c "CREATE DATABASE aesculap OWNER aesculap"
pnpm --filter @aesculap/shared build
pnpm db:migrate
pnpm db:seed
pnpm db:demo   # демо-витрина: поставщик, 18 товаров, статьи, подборка
pnpm dev
```

Сайт — http://localhost:4000, кабинет поставщика — /supplier, админка — /admin, проверка API — http://localhost:4100/api/healthz.

Администратор создаётся командой (временный пароль печатается один раз):

```bash
pnpm --filter @aesculap/api admin:create admin@example.ru
```

Фоновые задачи (импорт, фото по ссылкам, постеры видео, синк YML раз в 6 часов) выполняются очередью BullMQ на Redis внутри процесса API. Для постеров нужен `ffmpeg` (`brew install ffmpeg`). Файлы в dev лежат в `apps/api/.storage`.
Письма в dev не отправляются, а пишутся в лог API (`MAIL_DRIVER=console`): ссылки подтверждения email и сброса пароля берутся оттуда.

## Тесты

```bash
psql -d postgres -c "CREATE DATABASE aesculap_test OWNER aesculap"
DATABASE_URL=postgresql://aesculap:aesculap@localhost:5432/aesculap_test pnpm --filter @aesculap/api exec prisma migrate deploy
pnpm test
```

e2e-тесты API работают с базой `aesculap_test` и Redis db 6.
