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
ssh "$HOST" "set -e
  rsync -a --delete --exclude .env.production $DIR.new/ $DIR/ && rm -rf $DIR.new && echo $REV > $DIR/REVISION
  cd $DIR && C='docker compose -f docker-compose.prod.yml --env-file .env.production'
  \$C build 2>&1 | tail -3
  \$C up -d 2>&1 | tail -5
  # Ждём, пока API и сайт пройдут healthcheck (до 2 минут)
  for i in \$(seq 1 30); do [ \$(\$C ps --format '{{.Service}} {{.Status}}' | grep -cE '^(api|web) .*\\(healthy\\)') -eq 2 ] && break; sleep 4; done
  \$C ps --format 'table {{.Service}}\t{{.Status}}'
  docker image prune -f >/dev/null"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml --env-file .env.production ps --format '{{.Service}} {{.Status}}'" | grep -E '^(api|web) ' | grep -vq '(healthy)' && { echo "ВНИМАНИЕ: сервис не прошёл проверку — смотрите логи: ssh $HOST 'cd $DIR && docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 50 api web'" >&2; exit 1; }
echo "Готово: $REV — https://$(ssh "$HOST" "grep ^DOMAIN= $DIR/.env.production | cut -d= -f2")"
