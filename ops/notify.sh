#!/usr/bin/env bash
# Служебное сообщение администратору в Telegram (диск, бэкап): ops/notify.sh "текст"
#
# Токен бота — TELEGRAM_BOT_TOKEN в .env.production (тот же бот, что у уведомлений сайта), получатель —
# ALERT_TELEGRAM_CHAT_ID там же (id личного чата или группы; узнать: написать боту и открыть
# https://api.telegram.org/bot<токен>/getUpdates). Обе можно задать и переменными окружения.
# Сообщение всегда пишется в syslog (тег aesculap); без токена или чата — только туда, с кодом выхода 0.
set -uo pipefail

ENV_FILE="${ENV_FILE:-/srv/aesculap/.env.production}"
text="${1:?текст сообщения}"

env_get() { [[ -r "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true; }
TOKEN="${TELEGRAM_BOT_TOKEN:-$(env_get TELEGRAM_BOT_TOKEN)}"
CHAT="${ALERT_TELEGRAM_CHAT_ID:-$(env_get ALERT_TELEGRAM_CHAT_ID)}"

logger -t aesculap -- "$text" 2>/dev/null || true
echo "$(date '+%F %T') $text"
[[ -n "${DRY_RUN:-}" ]] && exit 0

if [[ -z "$TOKEN" || -z "$CHAT" ]]; then
  echo "TELEGRAM_BOT_TOKEN или ALERT_TELEGRAM_CHAT_ID не заданы — только syslog" >&2
  exit 0
fi
# Токен — в URL запроса к Telegram; в аргументы curl он не попадает (конфиг через stdin), в ps его не видно
curl -fsS --max-time 15 -o /dev/null -K - --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$text" <<<"url = \"https://api.telegram.org/bot$TOKEN/sendMessage\"" \
  || { echo "Не удалось отправить в Telegram" >&2; exit 1; }
