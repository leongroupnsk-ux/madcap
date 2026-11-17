#!/usr/bin/env bash
# Сайт и API отвечают? Раз в минуту по cron (ставит ops/setup-server.sh):
#
#   * * * * * /srv/aesculap/ops/health-alert.sh >> /var/log/aesculap-health.log 2>&1
#
# Запросы идут через Caddy на этом же сервере (--resolve домена на 127.0.0.1): /api/healthz и главная страница.
# Два провала подряд — сообщение в Telegram (ops/notify.sh), дальше напоминание раз в REPEAT_MIN минут, после
# восстановления — «снова отвечает». Ловит падение API, сайта или Caddy, о котором само приложение сообщить не может;
# сервер целиком (сеть, питание) отсюда не виден — для этого внешний пинг (docs/DEPLOY.md, «Мониторинг»).
# Проверка без отправки: DRY_RUN=1 ops/health-alert.sh
set -uo pipefail

ENV_FILE="${ENV_FILE:-/srv/aesculap/.env.production}"
STATE="${STATE:-/var/lib/aesculap/health-alert.state}"
REPEAT_MIN="${REPEAT_MIN:-30}"
NOTIFY="$(dirname "$0")/notify.sh"
DOMAIN="${DOMAIN:-$(grep -E '^DOMAIN=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")}"
[[ -n "$DOMAIN" ]] || { echo "Нет DOMAIN в $ENV_FILE" >&2; exit 1; }
BASE="${BASE:-https://$DOMAIN}"
RESOLVE=(--resolve "$DOMAIN:443:127.0.0.1")
[[ -n "${BASE_OVERRIDE:-}" ]] && { BASE="$BASE_OVERRIDE"; RESOLVE=(); }

problems=()
api="$(curl -sS -m 10 ${RESOLVE[@]+"${RESOLVE[@]}"} "$BASE/api/healthz" 2>&1)" || true
[[ "$api" == *'"ok":true'* ]] || problems+=("API (/api/healthz): ${api:0:120}")
code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' ${RESOLVE[@]+"${RESOLVE[@]}"} "$BASE/" 2>/dev/null)" || true
[[ "$code" == 200 ]] || problems+=("главная страница: ${code:+ответ }${code:-нет ответа}")

now="$(date +%s)"
fails=0
last=0
if [[ -r "$STATE" ]]; then read -r fails last <"$STATE" || true; fi
fails="${fails:-0}"
last="${last:-0}"
send() { "$NOTIFY" "$1" || true; }

if (( ${#problems[@]} )); then
  fails=$((fails + 1))
  echo "$(date '+%F %T') провал $fails: ${problems[*]}"
  # Один провал — сбой сети или перезапуск при выкладке; два подряд — уже сообщение
  if (( fails == 2 )) || (( fails > 2 && now - last >= REPEAT_MIN * 60 )); then
    send "🔴 $DOMAIN не отвечает (проверка $fails раз подряд):
$(printf '%s\n' "${problems[@]}")
Логи: cd /srv/aesculap && docker compose -f docker-compose.prod.yml ps; … logs --tail 50 api web caddy"
    last="$now"
  fi
else
  (( fails >= 2 )) && send "✅ $DOMAIN снова отвечает (было $fails провалов подряд)"
  fails=0
fi

[[ -n "${DRY_RUN:-}" ]] && exit 0
mkdir -p "$(dirname "$STATE")"
echo "$fails $last" >"$STATE"
