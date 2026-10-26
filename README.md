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
pnpm db:demo   # демо-витрина: 2 поставщика (Москва и СПб), 25 товаров с фото из макета, статьи, подборка
pnpm dev
```

Сайт — http://localhost:4000, кабинет поставщика — /supplier, админка — /admin, проверка API — http://localhost:4100/api/healthz.

Администратор создаётся командой (временный пароль печатается один раз):

```bash
pnpm --filter @aesculap/api admin:create admin@example.ru
```

Фоновые задачи (импорт, фото по ссылкам, постеры видео, синк YML раз в 6 часов) выполняются очередью BullMQ на Redis внутри процесса API. Для постеров нужен `ffmpeg` (`brew install ffmpeg`). Файлы в dev лежат в `apps/api/.storage`.
Фото товаров и обложки журнала хранятся вместе с копиями по ширине 320/640/1200 px (WebP) для `srcset`: они создаются при загрузке, недостающие — при первом запросе файла или командой `pnpm --filter @aesculap/api thumbs:backfill` (подробнее — `apps/api/src/common/image-keys.ts`, docs/PERF.md). Шрифты лежат в `apps/web/src/fonts` (OFL), сборке сайта интернет не нужен.
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

Демо-аккаунты после `pnpm db:demo`: поставщики `demo.msk@example.ru` и `demo.spb@example.ru`, администратор `demo.admin@example.ru`; пароль — `DEMO_PASSWORD` из окружения или значение по умолчанию в `apps/api/prisma/demo.ts`. Только для dev-стенда. Демо создаёт идущую акцию «Неделя хирурга» и акцию «Осенний стоматолог» в приёме заявок.

Выплаты: поставщик заполняет реквизиты в кабинете («Выплаты»), после онбординга в ЮKassa админ вносит ID получателя в `/admin/payouts`.

## Акции и уведомления

Акции создаёт админ (`/admin/promotions`), поставщики заявляют товары со скидкой не ниже минимальной (`/supplier/promotions`), заявки модерирует админ. На время акции у варианта появляется `salePrice`: витрина, фильтр и сортировка по цене, корзина, капсула и заказ берут её, а цена поставщика и синк YML её не перетирают. Комиссия по акционной позиции — льготная, сплит и возвраты считаются по позициям. Старт и окончание подхватываются пересчётом раз в минуту.

Уведомления поставщику: колокольчик в кабинете (всегда), email и Telegram — по настройкам в «Настройки → Уведомления». Почта: `MAIL_DRIVER=smtp` и `SMTP_URL=smtp://user:pass@host:465`, `MAIL_FROM`. Telegram: `TELEGRAM_BOT_TOKEN` и `TELEGRAM_BOT_USERNAME` — API опрашивает бота сам (getUpdates), поставщик пишет боту /start и вводит код в кабинете. Без токена бот выключен.

## Премиум

`/premium` — своя ветка: лендинг, анкета из 7 шагов (гость — черновик в браузере, после входа — `premium_answers`), капсула только из товаров с флагом «Премиум-коллекция» (поставщик ставит его в форме товара, у опубликованного — через модерацию). Онлайн-оплаты нет: «Оставить заявку» создаёт заявку, письмо уходит на `ALERT_EMAIL`, менеджер ведёт её в `/admin/premium` (роль «Поддержка» или владелец).

## Отзывы, избранное, «Сообщить о поступлении»

Отзыв оставляет покупатель после доставки (профиль → «Мои отзывы» или «Оставить отзыв» у позиции доставленного заказа), публикует модератор в `/admin/reviews`; продавец отвечает один раз в карточке товара кабинета, ответ публикуется сразу. Избранное гостя хранится в браузере и переносится в аккаунт при входе (`/account/favorites`). Подписка «Сообщить о поступлении» — на вариант без остатка; письмо уходит фоновой задачей при пополнении (кабинет, импорт и фид, отмена заказа; плюс проверка раз в 15 минут), отписка — по ссылке из письма (секрет `UNSUBSCRIBE_SECRET`, как у рассылки). Демо: отзывы на 4 товара от `demo.buyer1…5@example.ru`, у «Халата «Классика»» размер XXL без остатка.

## Продакшен

Выкладка, бэкапы, мониторинг и чек-лист запуска — [docs/DEPLOY.md](docs/DEPLOY.md). Нагрузочный тест — [docs/LOAD.md](docs/LOAD.md). Права субъекта ПДн: «Профиль → Скачать мои данные / Удалить аккаунт», в админке — «Пользователи» (поиск, блокировка, выгрузка, удаление).

## Тесты

```bash
psql -d postgres -c "CREATE DATABASE aesculap_test OWNER aesculap"
DATABASE_URL=postgresql://aesculap:aesculap@localhost:5432/aesculap_test pnpm --filter @aesculap/api exec prisma migrate deploy
pnpm test
```

e2e-тесты API работают с базой `aesculap_test` и Redis db 6.

Браузерные e2e (Playwright, пакет `apps/e2e`) гоняются против запущенного dev-стенда (`pnpm dev`, база с `pnpm db:demo`):

```bash
pnpm --filter @aesculap/e2e exec playwright install chromium   # один раз
pnpm e2e                                   # все сценарии, axe и скриншоты
pnpm e2e tests/visual.spec.ts --update-snapshots   # обновить эталоны после намеренной правки вёрстки
```

Сценарии: заказ гостя с двумя отправлениями и оплатой → подтверждение поставщиком, анкета → капсула → корзина, премиум-заявка, мобильная вёрстка 360 px, проверки доступности axe (WCAG 2.1 AA, падают на serious/critical). Каждый прогон создаёт новых покупателей `e2e-<время>@example.ru` и заказы в dev-базе. Пароль демо-поставщика скрипт берёт из `apps/api/prisma/demo.ts` (или `E2E_DEMO_PASSWORD`). Эталоны скриншотов сняты на macOS — на другой ОС их нужно переснять. Замеры Lighthouse и доступности — [docs/PERF.md](docs/PERF.md).
