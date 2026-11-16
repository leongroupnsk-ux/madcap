#!/usr/bin/env bash
# Ежедневный бэкап (ТЗ §11): дамп PostgreSQL и файлы хранилища, копия вне сервера, хранение 30 дней.
#
#   DATABASE_URL=postgresql://…  BACKUP_DIR=/var/backups/aesculap  STORAGE_DIR=/srv/…/storage  ops/backup.sh
#
# На сервере его вызывает ops/backup-cron.sh (дамп внутри контейнера postgres, ключи хранилища из /etc/aesculap/backup.env).
#
# PG_EXEC — команда, внутри которой запускается pg_dump, например «docker compose … exec -T postgres»: версия pg_dump
# тогда всегда совпадает с сервером (в Ubuntu 24.04 клиент PostgreSQL 16, а база — 17). Пусто — pg_dump с хоста.
#
# Копия вне сервера — S3-совместимое хранилище в РФ (Yandex Object Storage, Selectel, VK Cloud), одно из двух:
#   S3_ENDPOINT=https://storage.yandexcloud.net S3_REGION=ru-central1 S3_BUCKET=… [S3_PREFIX=aesculap]
#   S3_ACCESS_KEY=… S3_SECRET_KEY=…   — загрузка curl с подписью AWS SigV4, отдельные утилиты не нужны;
#   OFFSITE=s3://bucket/aesculap AWS_ENDPOINT_URL=…   — через aws cli, если он установлен.
# Без них копия остаётся только локально, и скрипт об этом предупреждает. Срок хранения в бакете — правилом
# жизненного цикла (lifecycle) на стороне хранилища. Файлы хранилища в проде могут лежать в S3 (STORAGE_DRIVER=s3) —
# тогда STORAGE_DIR не задаётся, а бакет защищается версионированием.
set -euo pipefail

: "${DATABASE_URL:?нужен DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
umask 077

DB_FILE="$BACKUP_DIR/db-$STAMP.dump"
# shellcheck disable=SC2086 # PG_EXEC — команда с аргументами
if ! ${PG_EXEC:-} pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$DATABASE_URL" >"$DB_FILE" || [[ ! -s "$DB_FILE" ]]; then
  rm -f "$DB_FILE"
  echo "pg_dump не удался" >&2
  exit 1
fi
(cd "$BACKUP_DIR" && { sha256sum "$(basename "$DB_FILE")" 2>/dev/null || shasum -a 256 "$(basename "$DB_FILE")"; } >"$(basename "$DB_FILE").sha256")
echo "БД: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

if [[ -n "${STORAGE_DIR:-}" && -d "$STORAGE_DIR" ]]; then
  FILES="$BACKUP_DIR/files-$STAMP.tar.gz"
  tar -czf "$FILES" -C "$STORAGE_DIR" .
  echo "Файлы: $FILES ($(du -h "$FILES" | cut -f1))"
fi

s3_put() {
  # PUT объекта с подписью SigV4; ключи передаются curl через stdin, в аргументах процесса их не видно
  local file="$1" key="$2"
  curl -fsS --max-time 3600 -o /dev/null -K - -T "$file" <<EOF
url = "${S3_ENDPOINT%/}/$S3_BUCKET/$key"
aws-sigv4 = "aws:amz:${S3_REGION:-ru-central1}:s3"
user = "$S3_ACCESS_KEY:$S3_SECRET_KEY"
header = "x-amz-content-sha256: UNSIGNED-PAYLOAD"
EOF
}

if [[ -n "${S3_BUCKET:-}" ]]; then
  : "${S3_ENDPOINT:?нужен S3_ENDPOINT}" "${S3_ACCESS_KEY:?нужен S3_ACCESS_KEY}" "${S3_SECRET_KEY:?нужен S3_SECRET_KEY}"
  prefix="${S3_PREFIX:-aesculap}"
  for f in "$BACKUP_DIR"/*-"$STAMP".*; do
    s3_put "$f" "${prefix:+$prefix/}$(basename "$f")"
  done
  echo "Скопировано в $S3_ENDPOINT/$S3_BUCKET/$prefix (срок хранения там — правилом жизненного цикла бакета, $KEEP_DAYS дней)"
elif [[ -n "${OFFSITE:-}" ]]; then
  for f in "$BACKUP_DIR"/*-"$STAMP".*; do
    aws s3 cp --only-show-errors "$f" "$OFFSITE/$(basename "$f")" ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
  done
  echo "Скопировано в $OFFSITE (срок хранения там — правилом жизненного цикла бакета, $KEEP_DAYS дней)"
else
  echo "ВНИМАНИЕ: хранилище вне сервера не задано (S3_BUCKET или OFFSITE) — копия только на этом сервере" >&2
fi

# Локально держим KEEP_DAYS дней
find "$BACKUP_DIR" -type f \( -name 'db-*' -o -name 'files-*' \) -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/Удалён старый: /'
