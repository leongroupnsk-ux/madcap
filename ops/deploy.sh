#!/usr/bin/env bash
# Выкладка текущего коммита на сервер: ops/deploy.sh [ssh-хост]
# Заливает только файлы из git (без локальных .env и node_modules), собирает образы на сервере и
# перезапускает сервисы; миграции применяются при старте API. .env.production на сервере не трогается.
set -euo pipefail
HOST="${1:-aesculap-prod}"
DIR=/srv/aesculap
cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain)" ]]; then echo "Есть незакоммиченные изменения — выкладывается только коммит. Сначала закоммитьте." >&2; exit 1; fi
REV="$(git rev-parse --short HEAD)"
echo "→ $HOST: $REV"
git archive --format=tar HEAD | ssh "$HOST" "rm -rf $DIR.new && mkdir -p $DIR.new && tar -x -C $DIR.new"
# Сборка идёт на сервере в фоне (nohup): обрыв SSH-соединения её не прерывает.
# Номер версии пишется только после успешного запуска.
ssh "$HOST" "rsync -a --delete --exclude .env.production --exclude REVISION --exclude deploy.log $DIR.new/ $DIR/ && rm -rf $DIR.new
  cd $DIR && nohup bash -c \"set -o pipefail; C='docker compose -f docker-compose.prod.yml --env-file .env.production'
    { \\\$C build && \\\$C up -d \\
      && for i in \\\$(seq 1 45); do [ \\\$(\\\$C ps --format '{{.Service}} {{.Status}}' | grep -cE '^(api|web) .*\\\\(healthy\\\\)') -eq 2 ] && break; sleep 4; done \\
      && echo $REV > REVISION && docker image prune -f >/dev/null && echo DEPLOY_OK; } || echo DEPLOY_FAIL\" > deploy.log 2>&1 < /dev/null &"
# Ждём окончания короткими запросами (до 30 минут)
for i in $(seq 1 180); do
  sleep 10
  st=$(ssh -o ConnectTimeout=15 "$HOST" "tail -1 $DIR/deploy.log 2>/dev/null" || true)
  case "$st" in DEPLOY_OK) break ;; DEPLOY_FAIL) echo "Сборка не удалась, лог: ssh $HOST 'tail -50 $DIR/deploy.log'" >&2; exit 1 ;; esac
done
[ "$st" = DEPLOY_OK ] || { echo "Сборка не закончилась за 30 минут, лог: ssh $HOST 'tail -50 $DIR/deploy.log'" >&2; exit 1; }
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml --env-file .env.production ps --format 'table {{.Service}}\t{{.Status}}'"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml --env-file .env.production ps --format '{{.Service}} {{.Status}}'" | grep -E '^(api|web) ' | grep -vq '(healthy)' && { echo "ВНИМАНИЕ: сервис не прошёл проверку — смотрите логи: ssh $HOST 'cd $DIR && docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 50 api web'" >&2; exit 1; }
echo "Готово: $REV — https://$(ssh "$HOST" "grep ^DOMAIN= $DIR/.env.production | cut -d= -f2")"
