#!/usr/bin/env bash
# Предупреждение о заполнении диска сервера в Telegram. Запуск по cron раз в 15 минут:
#
#   */15 * * * * /srv/aesculap/ops/disk-alert.sh >> /var/log/aesculap-disk-alert.log 2>&1
#
# Отправка — ops/notify.sh: бот TELEGRAM_BOT_TOKEN, получатель ALERT_TELEGRAM_CHAT_ID из .env.production;
# без них сообщение пишется только в syslog.
#
# Шлёт сообщение, когда занято ≥ THRESHOLD% (по умолчанию 85), повторяет раз в REPEAT_HOURS (6), пока
# не освободится, и одно «диск в норме» после. Проверяет корень и каталог docker (если он на другом разделе).
# Проверка без отправки: DRY_RUN=1 THRESHOLD=1 ops/disk-alert.sh
set -euo pipefail

THRESHOLD="${THRESHOLD:-85}"
REPEAT_HOURS="${REPEAT_HOURS:-6}"
STATE="${STATE:-/var/lib/aesculap/disk-alert.state}"
NOTIFY="$(dirname "$0")/notify.sh"

# Точки проверки: корень и каталог данных docker; одинаковые разделы схлопываются
paths=(/)
[[ -d /var/lib/docker ]] && paths+=(/var/lib/docker)
report=""
over=0
declare -A seen=()
for p in "${paths[@]}"; do
  read -r dev pct avail < <(df -P -k "$p" | awk 'NR==2 {gsub("%","",$5); print $1, $5, $4}')
  [[ -n "${seen[$dev]:-}" ]] && continue
  seen[$dev]=1
  report+="$p — занято ${pct}%, свободно $((avail / 1024 / 1024)) ГБ"$'\n'
  (( pct >= THRESHOLD )) && over=1
done

host="$(hostname)"
now="$(date +%s)"
last=0
prev=ok
if [[ -r "$STATE" ]]; then read -r prev last <"$STATE" || true; fi

send() { "$NOTIFY" "$1" || true; }

if (( over )); then
  if [[ "$prev" != alert ]] || (( now - ${last:-0} >= REPEAT_HOURS * 3600 )); then
    send "⚠️ $host: на диске занято ${THRESHOLD}% или больше
${report}Что занимает место: docker system df; чистка кэша сборки: docker builder prune -f"
    last="$now"
  fi
  state=alert
else
  [[ "$prev" == alert ]] && send "✅ $host: диск в норме
${report%$'\n'}"
  state=ok
fi

[[ -n "${DRY_RUN:-}" ]] && exit 0
mkdir -p "$(dirname "$STATE")"
echo "$state ${last:-0}" >"$STATE"
