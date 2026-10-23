#!/usr/bin/env bash
# Ежедневный бэкап (ТЗ §11): дамп PostgreSQL и файлы хранилища, копия вне сервера, хранение 30 дней.
#
#   DATABASE_URL=postgresql://…  BACKUP_DIR=/var/backups/aesculap  STORAGE_DIR=/srv/aesculap/storage \
#   OFFSITE=s3://bucket/aesculap  AWS_ENDPOINT_URL=https://storage.yandexcloud.net  ops/backup.sh
#
# OFFSITE — S3-совместимое хранилище в РФ (Yandex Object Storage, Selectel, VK Cloud); без него копия
# остаётся только локально, и скрипт об этом предупреждает. Файлы хранилища в проде лежат в S3 — тогда
# STORAGE_DIR не задаётся, а бакет защищается версионированием на стороне хранилища.
set -euo pipefail

: "${DATABASE_URL:?нужен DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

DB_FILE="$BACKUP_DIR/db-$STAMP.dump"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$DB_FILE"
sha256sum "$DB_FILE" 2>/dev/null >"$DB_FILE.sha256" || shasum -a 256 "$DB_FILE" >"$DB_FILE.sha256"
echo "БД: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

if [[ -n "${STORAGE_DIR:-}" && -d "$STORAGE_DIR" ]]; then
  FILES="$BACKUP_DIR/files-$STAMP.tar.gz"
  tar -czf "$FILES" -C "$STORAGE_DIR" .
  echo "Файлы: $FILES ($(du -h "$FILES" | cut -f1))"
fi

if [[ -n "${OFFSITE:-}" ]]; then
  for f in "$BACKUP_DIR"/*-"$STAMP".*; do
    aws s3 cp --only-show-errors "$f" "$OFFSITE/$(basename "$f")" ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
  done
  echo "Скопировано в $OFFSITE (срок хранения там — правилом жизненного цикла бакета, $KEEP_DAYS дней)"
else
  echo "ВНИМАНИЕ: OFFSITE не задан — копия только на этом сервере" >&2
fi

# Локально держим KEEP_DAYS дней
find "$BACKUP_DIR" -type f \( -name 'db-*' -o -name 'files-*' \) -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/Удалён старый: /'
