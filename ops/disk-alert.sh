#!/usr/bin/env bash
# Предупреждение о заполнении диска сервера в Telegram. Запуск по cron раз в 15 минут:
#
#   */15 * * * * /srv/aesculap/ops/disk-alert.sh >> /var/log/aesculap-disk-alert.log 2>&1
#
# Токен бота берётся из TELEGRAM_BOT_TOKEN в .env.production (тот же бот, что у уведомлений),
# получатель — ALERT_TELEGRAM_CHAT_ID там же (id личного чата или группы; узнать: написать боту
# и открыть https://api.telegram.org/bot<токен>/getUpdates). Без них сообщение пишется только в syslog.
#
# Шлёт сообщение, когда занято ≥ THRESHOLD% (по умолчанию 85), повторяет раз в REPEAT_HOURS (6), пока
# не освободится, и одно «диск в норме» после. Проверяет корень и каталог docker (если он на другом разделе).
# Проверка без отправки: DRY_RUN=1 THRESHOLD=1 ops/disk-alert.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-/srv/aesculap/.env.production}"
THRESHOLD="${THRESHOLD:-85}"
REPEAT_HOURS="${REPEAT_HOURS:-6}"
STATE="${STATE:-/var/lib/aesculap/disk-alert.state}"

env_get() { [[ -r "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true; }
TOKEN="${TELEGRAM_BOT_TOKEN:-$(env_get TELEGRAM_BOT_TOKEN)}"
CHAT="${ALERT_TELEGRAM_CHAT_ID:-$(env_get ALERT_TELEGRAM_CHAT_ID)}"

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

send() {
  local text="$1"
  logger -t aesculap-disk-alert -- "$text" 2>/dev/null || true
  echo "$(date '+%F %T') $text"
  [[ -n "${DRY_RUN:-}" ]] && return 0
  if [[ -n "$TOKEN" && -n "$CHAT" ]]; then
    curl -fsS --max-time 15 -o /dev/null "https://api.telegram.org/bot$TOKEN/sendMessage" \
      --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$text" \
      || echo "Не удалось отправить в Telegram" >&2
  else
    echo "TELEGRAM_BOT_TOKEN или ALERT_TELEGRAM_CHAT_ID не заданы — только syslog" >&2
  fi
}

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
