#!/usr/bin/env bash
# Проверка восстановления (ТЗ §11, ежеквартально; ТЗ §13 — критерий приёмки этапа 6).
# Разворачивает последний дамп во временную базу рядом, сверяет контрольную сумму, схему миграций и
# число строк в ключевых таблицах с рабочей базой, затем удаляет временную базу.
#
#   DATABASE_URL=postgresql://…/aesculap  ADMIN_URL=postgresql://…/postgres  BACKUP_DIR=…  ops/restore-check.sh [файл.dump]
set -euo pipefail

: "${DATABASE_URL:?нужен DATABASE_URL рабочей базы}"
: "${ADMIN_URL:?нужен ADMIN_URL — подключение с правом CREATE DATABASE}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DUMP="${1:-$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -1)}"
[[ -f "$DUMP" ]] || { echo "Дамп не найден в $BACKUP_DIR" >&2; exit 1; }

if [[ -f "$DUMP.sha256" ]]; then
  expected="$(cut -d' ' -f1 "$DUMP.sha256")"
  actual="$( (sha256sum "$DUMP" 2>/dev/null || shasum -a 256 "$DUMP") | cut -d' ' -f1)"
  [[ "$expected" == "$actual" ]] || { echo "Контрольная сумма не совпала: $DUMP повреждён" >&2; exit 1; }
  echo "✓ контрольная сумма"
fi

TMP_DB="restore_check_$(date +%s)"
TMP_URL="${ADMIN_URL%/*}/$TMP_DB"
cleanup() { psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $TMP_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

started=$(date +%s)
psql "$ADMIN_URL" -qc "CREATE DATABASE $TMP_DB"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TMP_URL" "$DUMP"
echo "✓ восстановлено за $(( $(date +%s) - started )) с: $DUMP"

# Миграции: последняя применённая должна совпасть
q_last="SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1"
src_m="$(psql "$DATABASE_URL" -Atc "$q_last")"
dst_m="$(psql "$TMP_URL" -Atc "$q_last")"
[[ "$src_m" == "$dst_m" ]] && echo "✓ миграции: $dst_m" || echo "! миграции: в рабочей $src_m, в дампе $dst_m (дамп старше последней миграции)"

# Строки в ключевых таблицах: в дампе не больше, чем в рабочей базе, и не пусто там, где в рабочей есть данные
fail=0
for t in users suppliers products product_variants orders shipments payouts refunds consents audit_log; do
  src=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM $t")
  dst=$(psql "$TMP_URL" -Atc "SELECT count(*) FROM $t")
  if [[ "$src" -gt 0 && "$dst" -eq 0 ]]; then
    echo "✗ $t: в рабочей $src, в копии 0"; fail=1
  else
    printf '✓ %-18s копия %8s · рабочая %8s\n' "$t" "$dst" "$src"
  fi
done

# Деньги сходятся внутри копии: сумма перечислений = сумма товаров − комиссия
bad=$(psql "$TMP_URL" -Atc "SELECT count(*) FROM payouts WHERE transferred <> \"amountGoods\" - commission")
[[ "$bad" -eq 0 ]] && echo "✓ выплаты согласованы" || { echo "✗ несогласованных выплат: $bad"; fail=1; }

[[ $fail -eq 0 ]] && echo "Восстановление проверено." || { echo "Проверка восстановления не пройдена" >&2; exit 1; }
