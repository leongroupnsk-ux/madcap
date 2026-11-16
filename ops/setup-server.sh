#!/usr/bin/env bash
# Подготовка чистого сервера Ubuntu 24.04 / 26.04 под сайт (боевой или новый демо-стенд). Запуск от root один раз;
# повторный запуск безопасен — файлы настроек перезаписываются, остальное пропускается.
#
#   scp ops/setup-server.sh root@<IP>:  &&  ssh root@<IP> 'bash setup-server.sh'
#
# Параметры (переменные окружения):
#   SSH_PORT=22         порт SSH. Сменить на нестандартный — меньше подбора паролей в логах; старый порт 22
#                       остаётся открытым, пока не проверен вход по новому (см. вывод в конце)
#   CLOSE_PORT_22=1     закрыть 22 в файрволе (второй запуск, после проверки входа по SSH_PORT)
#   EXTRA_PORTS="10050" дополнительные TCP-порты (10050 — агент мониторинга Timeweb)
#   SWAP_GB=4           размер файла подкачки, если его ещё нет (0 — не создавать)
#
# Что делает: Docker и compose из пакетов Ubuntu; SSH только по ключу с ограничением одновременных попыток входа
# (MaxStartups — на демо-стенде подбор паролей забивал sshd, и вход рвался до авторизации); fail2ban (sshd и
# повторные нарушители); ufw — только SSH, 80, 443 (tcp и udp для HTTP/3); автоматические обновления безопасности;
# подкачка; ограничение журналов; каталоги /srv/aesculap, /var/backups/aesculap, /etc/aesculap; cron бэкапа и
# предупреждения о диске; ротация логов. Сайт не ставит — это следующий шаг (docs/DEPLOY.md, «Боевой сервер с нуля»).
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
EXTRA_PORTS="${EXTRA_PORTS:-}"
SWAP_GB="${SWAP_GB:-4}"
APP_DIR=/srv/aesculap

say() { printf '\n== %s\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "Запускать от root" >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || { echo "Скрипт рассчитан на Ubuntu, здесь ${PRETTY_NAME:-неизвестная ОС}" >&2; exit 1; }
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo "SSH_PORT — число" >&2; exit 1; }

# Без ключа после отключения паролей на сервер не войти — проверяем до любых изменений
keys=0
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do [[ -s "$f" ]] && keys=1; done
(( keys )) || { echo "Нет ни одного authorized_keys с ключом. Сначала: ssh-copy-id root@<IP> (с машины, откуда будете входить)" >&2; exit 1; }

say "Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl ufw fail2ban unattended-upgrades rsync cron logrotate
if ! command -v docker >/dev/null; then
  apt-get install -yq docker.io docker-compose-v2
  apt-get install -yq docker-buildx 2>/dev/null || echo "docker-buildx нет в репозитории — compose соберёт образы встроенным сборщиком"
fi
systemctl enable --now docker cron >/dev/null
docker compose version

say "Автоматические обновления безопасности"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

say "Подкачка"
if [[ "$SWAP_GB" != 0 ]] && ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  sysctl -q vm.swappiness=10
  echo 'vm.swappiness=10' >/etc/sysctl.d/90-aesculap-swap.conf
  echo "создана /swapfile ${SWAP_GB} ГБ"
else
  echo "подкачка уже есть или не нужна"
fi

say "Журналы systemd — не больше 500 МБ"
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' >/etc/systemd/journald.conf.d/90-aesculap.conf
systemctl restart systemd-journald

say "Логи Docker по умолчанию — 5 × 10 МБ на контейнер"
if [[ ! -s /etc/docker/daemon.json ]]; then
  mkdir -p /etc/docker
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "5" }\n}\n' >/etc/docker/daemon.json
  systemctl restart docker
else
  echo "/etc/docker/daemon.json уже есть — не трогаю (у сервисов сайта ограничение задано в docker-compose.prod.yml)"
fi

say "Файрвол ufw"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "$SSH_PORT/tcp" comment ssh >/dev/null
[[ "$SSH_PORT" != 22 && -z "${CLOSE_PORT_22:-}" ]] && ufw allow 22/tcp comment 'ssh old' >/dev/null
[[ -n "${CLOSE_PORT_22:-}" && "$SSH_PORT" != 22 ]] && ufw delete allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp comment http >/dev/null
ufw allow 443/tcp comment https >/dev/null
ufw allow 443/udp comment http3 >/dev/null
for p in $EXTRA_PORTS; do ufw allow "$p/tcp" >/dev/null; done
ufw --force enable >/dev/null
ufw status verbose | sed -n '1,30p'
# Docker публикует порты в обход ufw: в docker-compose.prod.yml наружу открыты только 80/443 (Caddy),
# PostgreSQL — на 127.0.0.1. Новые публикуемые порты добавлять так же осознанно.

say "SSH: только ключи, порт $SSH_PORT"
cat >/etc/ssh/sshd_config.d/00-aesculap-hardening.conf <<EOF
# ops/setup-server.sh — вход только по ключу, без интерактивных паролей
Port $SSH_PORT
$([[ "$SSH_PORT" != 22 && -z "${CLOSE_PORT_22:-}" ]] && echo "Port 22")
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 20
# Не больше 10 неавторизованных соединений сразу, дальше часть отбрасывается: подбор паролей не забивает sshd
MaxStartups 10:30:60
X11Forwarding no
EOF
sshd -t
# В Ubuntu 24.04+ SSH запускается через ssh.socket: порт берётся из sshd_config при перечитывании юнитов
if systemctl is-enabled ssh.socket >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl restart ssh.socket
else
  systemctl restart ssh
fi

say "fail2ban"
cat >/etc/fail2ban/jail.d/aesculap.conf <<EOF
[DEFAULT]
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = $SSH_PORT$([[ "$SSH_PORT" != 22 && -z "${CLOSE_PORT_22:-}" ]] && echo ",22")

# Повторные нарушители — на неделю
[recidive]
enabled = true
backend = auto
logpath = /var/log/fail2ban.log
bantime = 1w
findtime = 1d
maxretry = 3
EOF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban
sleep 2
fail2ban-client status | sed -n '1,5p' || echo "fail2ban ещё запускается — проверить: fail2ban-client status sshd"

say "Каталоги"
mkdir -p "$APP_DIR" /var/lib/aesculap
install -d -m 700 /var/backups/aesculap /etc/aesculap
if [[ ! -e /etc/aesculap/backup.env ]]; then
  install -m 600 /dev/null /etc/aesculap/backup.env
  echo "создан пустой /etc/aesculap/backup.env — заполнить по ops/backup.env.example"
fi

say "Расписание: бэкап в 03:30, проверка диска раз в 15 минут"
cat >/etc/cron.d/aesculap <<EOF
# ops/setup-server.sh. Скрипты появляются в $APP_DIR после первой выкладки (ops/deploy.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root [ -x $APP_DIR/ops/backup-cron.sh ] && $APP_DIR/ops/backup-cron.sh >> /var/log/aesculap-backup.log 2>&1
*/15 * * * * root [ -x $APP_DIR/ops/disk-alert.sh ] && $APP_DIR/ops/disk-alert.sh >> /var/log/aesculap-disk-alert.log 2>&1
EOF
chmod 644 /etc/cron.d/aesculap

cat >/etc/logrotate.d/aesculap <<'EOF'
/var/log/aesculap-*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF

say "Готово"
cat <<EOF
Дальше (docs/DEPLOY.md, «Боевой сервер с нуля»):
1. Не закрывая эту сессию, проверить вход в новой: ssh -p $SSH_PORT root@<IP>
$([[ "$SSH_PORT" != 22 ]] && echo "   Если вход по $SSH_PORT работает — закрыть 22: CLOSE_PORT_22=1 SSH_PORT=$SSH_PORT bash setup-server.sh")
2. $APP_DIR/.env.production по образцу .env.production.example, chmod 600; /etc/aesculap/backup.env по ops/backup.env.example.
3. С машины разработчика: ops/deploy.sh <хост из ~/.ssh/config>.
EOF
