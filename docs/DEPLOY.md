# Выкладка и эксплуатация

## Сервер

- VPS в РФ (ТЗ §11: БД и хранилища — на серверах в РФ): от 4 vCPU, 8 ГБ RAM, 80 ГБ SSD. По нагрузочному тесту (docs/LOAD.md) один такой сервер держит целевые 200 покупателей с запасом.
- Ubuntu 24.04, Docker Engine + compose plugin, открыты только 22, 80, 443.
- DNS: A-запись домена и `www` на IP сервера.

## Первый запуск

```bash
git clone <репозиторий> /srv/aesculap && cd /srv/aesculap
cp .env.production.example .env.production && chmod 600 .env.production   # заполнить ключи
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts          # справочники
docker compose -f docker-compose.prod.yml exec api npx tsx scripts/create-admin.ts admin@домен
```

API не стартует, если в продакшене остались заглушки оплаты, почты или доставки, или `WEB_ORIGIN` не https — список проблем печатается в лог (`docker compose logs api`). Для демо-стенда без ключей — `ALLOW_TEST_PROVIDERS=1` в `.env.production`.

## Внешние сервисы

| Сервис | Что настроить |
| --- | --- |
| ЮKassa | HTTP-уведомления: `https://<домен>/api/payments/webhook`, события `payment.succeeded`, `payment.canceled`, `refund.succeeded`. Подключить «Чеки от ЮKassa» и сплитование. Каждому поставщику — онбординг, его `account_id` админ вносит в `/admin/payouts`. |
| СДЭК | Боевые ключи интеграции; вебхук `ORDER_STATUS` на `https://<домен>/api/delivery/cdek-webhook` (подписка через API `POST /v2/webhooks`). Без вебхука статусы обновляются опросом раз в час. Сверить коды формы собственности продавца (137/63) со справочником. |
| Почта | SMTP транзакционного сервиса; SPF, DKIM, DMARC на домене отправителя. |
| Telegram | Бот через @BotFather, токен и имя — в `.env.production`. |
| Яндекс SmartCaptcha (необязательно) | Консоль Yandex Cloud → SmartCaptcha → создать капчу, в списке хостов — домен сайта. Ключ сервера → `SMARTCAPTCHA_SERVER_KEY`, ключ клиента → `SMARTCAPTCHA_CLIENT_KEY` (оба в `.env.production`, задаются парой). Без ключей лимиты входа, регистрации, сброса пароля и заявки поставщика отвечают 429; с ключами после порога чуть ниже лимита форма показывает капчу. |
| Яндекс Карты (необязательно) | Кабинет разработчика developer.tech.yandex.ru → «JavaScript API и HTTP Геокодер» → ключ; в настройках ключа ограничить HTTP Referer доменом сайта. Ключ → `YMAPS_API_KEY`. Без ключа в окне выбора ПВЗ — заглушка со списком. |
| DaData (необязательно) | dadata.ru → Личный кабинет → «API-ключ» (тариф с «Подсказками»). Ключ → `DADATA_API_KEY`. Без ключа поле «Улица и дом» работает без подсказок. |

Ключи интеграций читает только сервис `api` (`env_file: .env.production`); браузер получает ключ клиента капчи (`GET /api/auth/captcha-config`) и ключ карт (`GET /api/delivery/config`) от API, поэтому после правки `.env.production` достаточно `docker compose -f docker-compose.prod.yml --env-file .env.production up -d api` — пересобирать `web` не нужно. Заголовок CSP (`apps/web/next.config.ts`) уже разрешает домены SmartCaptcha и Яндекс Карт.

## Обновление

С машины разработчика (хост `aesculap-prod` в `~/.ssh/config`):

```bash
ops/deploy.sh
```

Скрипт заливает текущий коммит в `/srv/aesculap`, собирает образы на сервере и перезапускает сервисы; `.env.production` не трогается.

Миграции применяются при старте контейнера API. Откат: `git checkout <предыдущий тег>` и та же команда; миграции в проекте только добавляют столбцы и таблицы, поэтому старая версия работает на новой схеме.

## Бэкапы (ТЗ §11)

Ежедневно в 03:30, хранение 30 дней, копия в S3-хранилище в РФ:

```cron
30 3 * * * cd /srv/aesculap && DATABASE_URL=postgresql://aesculap:$PG@127.0.0.1:5432/aesculap BACKUP_DIR=/var/backups/aesculap STORAGE_DIR=/var/lib/docker/volumes/aesculap_storage/_data OFFSITE=s3://<бакет>/aesculap AWS_ENDPOINT_URL=https://storage.yandexcloud.net ops/backup.sh >> /var/log/aesculap-backup.log 2>&1
```

Проверка восстановления — раз в квартал и после каждого изменения схемы бэкапа:

```bash
DATABASE_URL=…/aesculap ADMIN_URL=…/postgres BACKUP_DIR=/var/backups/aesculap ops/restore-check.sh
```

Скрипт разворачивает последний дамп во временную базу, сверяет контрольную сумму, миграции, строки в ключевых таблицах и согласованность выплат, затем удаляет временную базу. Проверено 2026-10-23 на dev-базе.

## Мониторинг

- `GET /api/healthz` — БД и Redis; используется healthcheck контейнеров. Внешний пинг (UptimeRobot / Яндекс Мониторинг) — раз в минуту.
- Падение вебхука ЮKassa — письмо на `ALERT_EMAIL` (не чаще раза в 10 минут) и ошибка в логе; ЮKassa повторяет уведомление.
- Логи: `docker compose logs -f api web`. Централизованный сбор (Loki / Яндекс Cloud Logging) — при подключении наблюдаемости.

## Демо-стенд (с 2026-10-23)

- Сервер Timeweb Cloud, Новосибирск: 201.24.63.39, Ubuntu 26.04, 2 vCPU / 4 ГБ (+4 ГБ swap) / 48 ГБ. Для боевого запуска — поднять до 4 vCPU / 8 ГБ.
- Адрес https://201-24-63-39.sslip.io (временный, сертификат Let's Encrypt); свой домен — сменить `DOMAIN` в `.env.production` и перезапустить.
- `ALLOW_TEST_PROVIDERS=1`, `SITE_NOINDEX=1`: тестовые оплата и доставка, письма в лог `api`, закрыт от поисковиков. Демо-данные — `prisma/demo.ts`, пароль демо-входов — `DEMO_PASSWORD` в `.env.production` на сервере.
- Файрвол ufw: 22, 80, 443, 10050 (агент мониторинга Timeweb).
- Бэкап: `/usr/local/bin/aesculap-backup` по cron в 03:30, `/var/backups/aesculap`; копии вне сервера (S3) пока нет. Восстановление проверено 2026-10-23.

## Перед запуском (ТЗ §11, §13)

- [ ] Уведомление Роскомнадзора об обработке ПДн подано
- [ ] Юридические тексты (`/legal/*`) проверены юристом, реквизиты оператора заполнены
- [ ] Боевые ключи ЮKassa, СДЭК, SMTP; вебхуки настроены
- [ ] Бэкап по cron работает, копия появилась в S3, `restore-check.sh` пройден на сервере
- [ ] Реальный заказ оплачен, отгружен и доставлен (критерий приёмки этапа 6)
