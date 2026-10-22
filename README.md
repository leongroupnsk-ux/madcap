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
pnpm db:demo   # демо-витрина: 2 поставщика (Москва и СПб), 18 товаров, статьи, подборка
pnpm dev
```

Сайт — http://localhost:4000, кабинет поставщика — /supplier, админка — /admin, проверка API — http://localhost:4100/api/healthz.

Администратор создаётся командой (временный пароль печатается один раз):

```bash
pnpm --filter @aesculap/api admin:create admin@example.ru
```

Фоновые задачи (импорт, фото по ссылкам, постеры видео, синк YML раз в 6 часов) выполняются очередью BullMQ на Redis внутри процесса API. Для постеров нужен `ffmpeg` (`brew install ffmpeg`). Файлы в dev лежат в `apps/api/.storage`.
Письма в dev не отправляются, а пишутся в лог API (`MAIL_DRIVER=console`): ссылки подтверждения email и сброса пароля берутся оттуда.

## Заказы, оплата и доставка

Драйверы выбираются в `.env`:

| Переменная | Значения | По умолчанию |
| --- | --- | --- |
| `PAYMENTS_DRIVER` | `fake` — тестовая страница оплаты `/pay/test/…` (карта, СБП, отказ банка); `yookassa` — ЮKassa для платформ со сплитом, нужны `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY` | `fake` |
| `DELIVERY_DRIVER` | `fake` — офлайн-тарифы и ПВЗ для шести городов; `cdek` — СДЭК API v2, нужны `CDEK_CLIENT_ID` и `CDEK_CLIENT_SECRET` | `fake` |
| `ORDER_PAY_MINUTES` | сколько держится резерв и ждёт оплата | `30` |
| `SHIPMENT_CONFIRM_HOURS` | через сколько неподтверждённое отправление отменяется с возвратом | `48` |

Для тестового контура СДЭК: `DELIVERY_DRIVER=cdek`, `CDEK_API_URL=https://api.edu.cdek.ru/v2` и тестовые ключи из документации СДЭК. Клиент проверен на этом контуре: подсказки городов, ПВЗ, тарифы, создание заказа, трек и PDF накладной. Вебхуки: ЮKassa → `POST /api/payments/webhook`, СДЭК → `POST /api/delivery/cdek-webhook`. Статус оплаты меняется только по вебхуку, причём сам платёж перечитывается через API платёжки.

Демо-кабинеты поставщиков после `pnpm db:demo`: `demo.msk@example.ru` и `demo.spb@example.ru`, пароль — `DEMO_PASSWORD` из окружения или значение по умолчанию в `apps/api/prisma/demo.ts`. Только для dev-стенда.

Выплаты: поставщик заполняет реквизиты в кабинете («Выплаты»), после онбординга в ЮKassa админ вносит ID получателя в `/admin/payouts`.

## Тесты

```bash
psql -d postgres -c "CREATE DATABASE aesculap_test OWNER aesculap"
DATABASE_URL=postgresql://aesculap:aesculap@localhost:5432/aesculap_test pnpm --filter @aesculap/api exec prisma migrate deploy
pnpm test
```

e2e-тесты API работают с базой `aesculap_test` и Redis db 6.
