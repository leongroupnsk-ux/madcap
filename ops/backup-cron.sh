#!/usr/bin/env bash
# Ночной бэкап на сервере (cron, ставит ops/setup-server.sh):
#
#   30 3 * * * root /srv/aesculap/ops/backup-cron.sh >> /var/log/aesculap-backup.log 2>&1
#
# Дамп снимается внутри контейнера postgres (pg_dump той же версии, что база; вход по локальному сокету, без пароля),
# файлы — из docker-тома storage. Ключи хранилища вне сервера — в /etc/aesculap/backup.env (права 600, только root;
# образец — ops/backup.env.example): в .env.production им не место, его целиком получает контейнер api.
# При сбое — сообщение в Telegram (ops/notify.sh), в лог — подробности.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/aesculap}"
BACKUP_ENV="${BACKUP_ENV:-/etc/aesculap/backup.env}"
OPS="$(cd "$(dirname "$0")" && pwd)"

fail() {
  "$OPS/notify.sh" "❌ $(hostname): бэкап не удался — $1. Лог: /var/log/aesculap-backup.log" || true
  exit 1
}
trap 'fail "ошибка в строке $LINENO"' ERR

echo "=== $(date '+%F %T') бэкап"
if [[ -r "$BACKUP_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$BACKUP_ENV"
  set +a
fi

export BACKUP_DIR="${BACKUP_DIR:-/var/backups/aesculap}"
export DATABASE_URL="postgresql://aesculap@/aesculap"
export PG_EXEC="${PG_EXEC:-docker compose -f $APP_DIR/docker-compose.prod.yml --env-file $APP_DIR/.env.production exec -T postgres}"
STORAGE_DIR="$(docker volume inspect aesculap_storage --format '{{.Mountpoint}}' 2>/dev/null || true)"
export STORAGE_DIR

"$OPS/backup.sh" || fail "ops/backup.sh завершился с ошибкой"

# Хранилище вне сервера обязательно для боевого: без него молча копить локальные копии нельзя
if [[ -z "${S3_BUCKET:-}${OFFSITE:-}" && -z "${ALLOW_LOCAL_ONLY:-}" ]]; then
  fail "не задано хранилище вне сервера (S3_BUCKET в $BACKUP_ENV), копия только локальная"
fi
echo "=== готово"
