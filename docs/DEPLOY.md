# Выкладка и эксплуатация

## Сервер

- VPS в РФ (ТЗ §11: БД и хранилища — на серверах в РФ): от 4 vCPU, 8 ГБ RAM, 80 ГБ SSD. По нагрузочному тесту (docs/LOAD.md) один такой сервер держит целевые 200 покупателей с запасом.
- Ubuntu 24.04 или 26.04. Docker, файрвол, SSH только по ключу, fail2ban, обновления безопасности, подкачку, cron бэкапа и проверки диска ставит `ops/setup-server.sh` (ниже, «Боевой сервер с нуля»). Открыты только SSH, 80 и 443.
- DNS: A-запись домена и `www` на IP сервера.

## Боевой сервер с нуля

Порядок для боевого сервера (или нового демо-стенда). Шаги 1–4 и 6 — один раз, примерно час работы. Ключи и данные, которые нужны от владельца, — в разделе «Внешние сервисы».

1. **Сервер.** VPS в РФ, 4 vCPU / 8 ГБ / 80 ГБ, Ubuntu 24.04. При создании добавить свой SSH-ключ (или сразу после: `ssh-copy-id root@<IP>`). Пароль root больше не понадобится.
2. **Подготовка.** С машины разработчика:
   ```bash
   scp ops/setup-server.sh root@<IP>: && ssh root@<IP> 'SSH_PORT=22 bash setup-server.sh'
   ```
   `SSH_PORT=<другой>` переносит SSH на нестандартный порт, это меньше подбора паролей. Порт 22 остаётся открытым, пока не проверен вход по новому, потом закрывается повторным запуском с `CLOSE_PORT_22=1`. На Timeweb для их агента мониторинга нужен `EXTRA_PORTS=10050`. Запуск без SSH-ключа на сервере скрипт отклоняет, чтобы после отключения паролей не потерять доступ.
3. **Хост в `~/.ssh/config`** на машине разработчика, например `aesculap-live` (`HostName <IP>`, `User root`, `Port`). Хост `aesculap-prod` — это демо-стенд, `ops/deploy.sh` без аргумента выкладывает на него.
4. **DNS.** A-записи домена и `www` на IP сервера. Сертификат Caddy выпустит сам при первом запуске, но только когда записи разошлись.
5. **Настройки** — на сервере:
   ```bash
   mkdir -p /srv/aesculap && cd /srv/aesculap
   # .env.production — по образцу .env.production.example из репозитория; пароль базы: openssl rand -hex 24
   nano .env.production && chmod 600 .env.production
   # ключи хранилища для бэкапа — по образцу ops/backup.env.example (файл уже создан, права 600)
   nano /etc/aesculap/backup.env
   ```
6. **Выкладка** с машины разработчика: `ops/deploy.sh aesculap-live`. Затем на сервере проверка настроек, справочники и администратор:
   ```bash
   cd /srv/aesculap && ops/check-env.sh             # ошибки — что не заполнено или осталось от демо (значения не печатаются)
   docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts
   docker compose -f docker-compose.prod.yml exec api npx tsx scripts/create-admin.ts admin@домен
   ```
   API сам не стартует без боевых ключей оплаты, доставки и почты (`docker compose logs api`). `check-env.sh` показывает то же заранее, а также домен, пароль базы, реквизиты оператора и бэкап.
7. **Проверка служебных сообщений и бэкапа:**
   ```bash
   ops/notify.sh "Проверка: сообщения с сервера доходят"          # приходит в ALERT_TELEGRAM_CHAT_ID
   ops/backup-cron.sh                                             # дамп и копия в хранилище; при ошибке — сообщение
   cd /srv/aesculap && PG_EXEC="docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres" \
     DATABASE_URL=postgresql://aesculap@/aesculap ADMIN_URL=postgresql://aesculap@/postgres BACKUP_DIR=/var/backups/aesculap \
     ops/restore-check.sh                                         # восстановление последнего дампа во временную базу
   ```
8. **Внешний пинг** (раздел «Мониторинг») и чек-лист «Перед запуском».

## Первый запуск (вручную)

```bash
git clone <репозиторий> /srv/aesculap && cd /srv/aesculap
cp .env.production.example .env.production && chmod 600 .env.production   # заполнить ключи
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts          # справочники
docker compose -f docker-compose.prod.yml exec api npx tsx scripts/create-admin.ts admin@домен
```

Владельцу (и ролям, отмеченным в «Сотрудники и настройки» → «Настройки платформы» → «Безопасность») вход в админку разрешён только с 2FA: после первого входа по паролю админка открывает лишь страницу «Профиль и безопасность», пока не подключено приложение-аутентификатор. Потерян телефон с кодами — сброс 2FA и всех сессий пользователя (запись `auth.2fa.reset` в журнале действий), после чего он входит по паролю и настраивает 2FA заново:

```bash
docker compose -f docker-compose.prod.yml exec api npx tsx scripts/reset-2fa.ts admin@домен
```

`pnpm db:demo` выключает обязательную 2FA только на локальной машине разработки (NODE_ENV≠production). На серверах, включая демо-стенд, правило действует всегда: демо-админу `demo.admin@example.ru` там тоже нужна 2FA.

Prisma CLI настраивается `apps/api/prisma.config.ts` (схема, миграции, seed); `.env` он читает сам через dotenv, в контейнере `DATABASE_URL` берётся из окружения.

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
| Яндекс Метрика (необязательно) | metrika.yandex.ru → «Добавить счётчик»: адрес сайта, **вебвизор выключить** (на страницах есть ПДн), карта кликов, внешние ссылки и точный показатель отказов — включить. Номер счётчика → `METRIKA_ID`. Цели (тип «JavaScript-событие»): `quiz_done` — анкета пройдена, `capsule_to_cart` — капсула в корзину, `order_placed` — заказ оформлен, `premium_request` — премиум-заявка. Счётчик грузится только после «Разрешить все» в cookie-баннере; без номера скрипт не подключается и запросов к Метрике нет. Домены Метрики уже в CSP (`apps/web/next.config.ts`). |
| DaData (необязательно) | dadata.ru → Личный кабинет → «API-ключ» (тариф с «Подсказками»). Ключ → `DADATA_API_KEY`. Без ключа поле «Улица и дом» работает без подсказок. |

Ключи интеграций читает только сервис `api` (`env_file: .env.production`); браузер получает ключ клиента капчи (`GET /api/auth/captcha-config`) и ключ карт (`GET /api/delivery/config`) от API, поэтому после правки `.env.production` достаточно `docker compose -f docker-compose.prod.yml --env-file .env.production up -d api` — пересобирать `web` не нужно. Заголовок CSP (`apps/web/next.config.ts`) уже разрешает домены SmartCaptcha и Яндекс Карт.

## Обновление

С машины разработчика (хост `aesculap-prod` в `~/.ssh/config`):

```bash
ops/deploy.sh
```

Скрипт заливает текущий коммит в `/srv/aesculap`, собирает образы на сервере и перезапускает сервисы; `.env.production` не трогается.

Миграции применяются при старте контейнера API. Откат: `git checkout <предыдущий тег>` и та же команда; миграции в проекте только добавляют столбцы и таблицы, поэтому старая версия работает на новой схеме.

Копии фото по ширине (320/640/1200 для `srcset` витрины) создаются при загрузке, а для загруженных раньше — при первом запросе. Чтобы первые посетители не ждали их создания, после выкладки, где они появились, можно один раз досоздать всё заранее (повторный запуск безопасен):

```bash
docker compose -f docker-compose.prod.yml exec api npx tsx scripts/thumbs-backfill.ts
```

## Бэкапы (ТЗ §11)

Ежедневно в 03:30 (`/etc/cron.d/aesculap`, ставит `ops/setup-server.sh`) — `ops/backup-cron.sh`: дамп базы внутри контейнера postgres (pg_dump той же версии, что база), файлы из тома `storage`, копия в S3-хранилище в РФ, локально — `/var/backups/aesculap`, `KEEP_DAYS` дней. Загрузка в хранилище — `curl` с подписью AWS SigV4, отдельные утилиты не нужны. Ключи хранилища — в `/etc/aesculap/backup.env` (образец `ops/backup.env.example`), не в `.env.production`: тот целиком получает контейнер api. Срок хранения в бакете — правилом жизненного цикла (30 дней). Если дамп не снялся или не задано хранилище вне сервера, приходит сообщение в Telegram (`ops/notify.sh`). Лог — `/var/log/aesculap-backup.log`.

Вручную, без cron (например, на машине разработчика): `DATABASE_URL=… BACKUP_DIR=… [S3_…] ops/backup.sh`.

Проверка восстановления — раз в квартал и после каждого изменения схемы бэкапа:

```bash
cd /srv/aesculap && PG_EXEC="docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres" \
  DATABASE_URL=postgresql://aesculap@/aesculap ADMIN_URL=postgresql://aesculap@/postgres BACKUP_DIR=/var/backups/aesculap \
  ops/restore-check.sh
```

Скрипт разворачивает последний дамп во временную базу, сверяет контрольную сумму, миграции, строки в ключевых таблицах и согласованность выплат, затем удаляет временную базу. С `PG_EXEC` psql и pg_restore работают внутри контейнера, и их версии совпадают с базой: в Ubuntu 24.04 клиент PostgreSQL 16, он не прочтёт дамп 17-й версии. Проверено 2026-10-23 на dev-базе. 2026-11-17 цепочка «дамп в контейнере PostgreSQL 17 → копия в S3-совместимое хранилище → восстановление и сверка» проверена локально (RustFS вместо облака).

## Мониторинг

- `GET /api/healthz` — БД и Redis; используется healthcheck контейнеров. **Внешний пинг** — сервис вне сервера, иначе о падении самого сервера никто не узнает: UptimeRobot (бесплатно, проверка раз в 5 минут, уведомления в Telegram и на почту) или Яндекс Мониторинг. Проверка: HTTP(S) `https://<домен>/api/healthz`, ответ 200 с `{"ok":true}` (в UptimeRobot — тип «Keyword», слово `true`). Заводит владелец, на свою почту.
- Падение вебхука ЮKassa — письмо на `ALERT_EMAIL` (не чаще раза в 10 минут) и ошибка в логе; ЮKassa повторяет уведомление.
- Логи: `docker compose logs -f api web`. Каждый контейнер хранит не больше 5 × 10 МБ логов (`x-logging` в `docker-compose.prod.yml`, действует после пересоздания контейнеров — обычной выкладкой). Централизованный сбор (Loki / Яндекс Cloud Logging) — при подключении наблюдаемости.
- Диск: выкладка удаляет старые образы и кэш сборки старше 3 дней. `ops/disk-alert.sh` по cron раз в 15 минут шлёт в Telegram предупреждение, когда занято ≥ 85% (повтор раз в 6 часов, затем «диск в норме»). Бот — `TELEGRAM_BOT_TOKEN`, получатель — `ALERT_TELEGRAM_CHAT_ID` в `.env.production`; без них — только syslog. На новых серверах cron ставит `ops/setup-server.sh`; на демо-стенде (подготовлен раньше) — вручную:

```bash
( crontab -l 2>/dev/null; echo '*/15 * * * * /srv/aesculap/ops/disk-alert.sh >> /var/log/aesculap-disk-alert.log 2>&1' ) | crontab -
DRY_RUN=1 THRESHOLD=1 /srv/aesculap/ops/disk-alert.sh   # проверка без отправки
THRESHOLD=1 STATE=/tmp/t /srv/aesculap/ops/disk-alert.sh # пробное сообщение в Telegram
```

## Демо-стенд (с 2026-10-23)

- Сервер Timeweb Cloud, Новосибирск: 201.24.63.39, Ubuntu 26.04, 2 vCPU / 4 ГБ (+4 ГБ swap) / 48 ГБ. Для боевого запуска — поднять до 4 vCPU / 8 ГБ.
- Адрес https://201-24-63-39.sslip.io (временный, сертификат Let's Encrypt); свой домен — сменить `DOMAIN` в `.env.production` и перезапустить.
- `ALLOW_TEST_PROVIDERS=1`, `SITE_NOINDEX=1`: тестовые оплата и доставка, письма в лог `api`, закрыт от поисковиков. Демо-данные — `prisma/demo.ts`, пароль демо-входов — `DEMO_PASSWORD` в `.env.production` на сервере.
- Файрвол ufw: 22, 80, 443, 10050 (агент мониторинга Timeweb).
- SSH только по ключу (`/etc/ssh/sshd_config.d/00-aesculap-hardening.conf`, с 2026-10-26: до этого шёл подбор паролей ~6000 попыток в сутки), fail2ban банит подбор (`fail2ban-client status sshd`). Запасной вход — консоль в панели Timeweb.
- Выкладка `ops/deploy.sh` собирает образы на сервере в фоне (лог `/srv/aesculap/deploy.log`), обрыв SSH её не прерывает; `REVISION` пишется после успешного запуска.
- Бэкап: `/usr/local/bin/aesculap-backup` по cron в 03:30, `/var/backups/aesculap`; копии вне сервера (S3) пока нет. Восстановление проверено 2026-10-23.

## Перед запуском (ТЗ §11, §13)

- [ ] Уведомление Роскомнадзора об обработке ПДн подано
- [ ] Юридические тексты (`/legal/*`) проверены юристом, реквизиты оператора заполнены
- [ ] Боевые ключи ЮKassa, СДЭК, SMTP; вебхуки настроены
- [ ] `ops/check-env.sh` на сервере — без ошибок
- [ ] Бэкап по cron работает, копия появилась в S3, `restore-check.sh` пройден на сервере
- [ ] Служебные сообщения доходят (`ops/notify.sh`), внешний пинг `/api/healthz` настроен
- [ ] Реальный заказ оплачен, отгружен и доставлен (критерий приёмки этапа 6)
