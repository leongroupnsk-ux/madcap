#!/usr/bin/env bash
# Проверка .env.production перед запуском — что не заполнено или осталось от демо-стенда:
#
#   ops/check-env.sh [путь к .env.production] [--demo]
#
# Значения не печатаются, только имена переменных. Ошибки — запускать нельзя (код выхода 1), предупреждения — можно,
# но стоит доделать. --demo — для демо-стенда: заглушки оплаты и доставки разрешены, реквизиты не обязательны.
# API при старте сам проверяет ключи оплаты, доставки и почты (assertProductionConfig) — здесь то же плюс то,
# что API не видит: домен, пароль базы, реквизиты оператора, права файла, бэкап.
set -uo pipefail

FILE=".env.production"
DEMO=0
for a in "$@"; do
  case "$a" in
    --demo) DEMO=1 ;;
    *) FILE="$a" ;;
  esac
done
[[ -r "$FILE" ]] || { echo "Нет файла $FILE (образец — .env.production.example)" >&2; exit 1; }

errors=0
warnings=0
err() { echo "✗ $*"; errors=$((errors + 1)); }
warn() { echo "! $*"; warnings=$((warnings + 1)); }

# Значение как его увидит docker compose: последнее вхождение, без кавычек по краям
get() { grep -E "^$1=" "$FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
need() { [[ -n "$(get "$1")" ]] || err "$1 не заполнен${2:+ — $2}"; }
want() { [[ -n "$(get "$1")" ]] || warn "$1 не заполнен${2:+ — $2}"; }

# Права: в файле пароли и ключи
perm="$(stat -c %a "$FILE" 2>/dev/null || stat -f %Lp "$FILE")"
[[ "$perm" == 600 || "$perm" == 400 ]] || warn "права $FILE — $perm, нужно 600 (chmod 600 $FILE)"

domain="$(get DOMAIN)"
if [[ -z "$domain" || "$domain" == example.ru ]]; then
  err "DOMAIN не задан (в образце example.ru)"
elif [[ "$domain" == *://* || "$domain" == */* ]]; then
  err "DOMAIN — только имя, без https:// и пути"
elif command -v getent >/dev/null && ! getent hosts "$domain" >/dev/null; then
  warn "DOMAIN не резолвится — A-запись ещё не настроена или не разошлась (сертификат не выпустится)"
fi

pg="$(get POSTGRES_PASSWORD)"
if [[ -z "$pg" ]]; then
  err "POSTGRES_PASSWORD не заполнен (сгенерировать: openssl rand -hex 24)"
else
  (( ${#pg} >= 24 )) || err "POSTGRES_PASSWORD короче 24 символов (сгенерировать: openssl rand -hex 24)"
  [[ "$pg" =~ ^[A-Za-z0-9_-]+$ ]] || err "POSTGRES_PASSWORD — только латиница, цифры, _ и - (он стоит в адресе базы)"
fi

us="$(get UNSUBSCRIBE_SECRET)"
if [[ -z "$us" ]]; then err "UNSUBSCRIBE_SECRET не заполнен (openssl rand -hex 32)"; elif (( ${#us} < 32 )); then warn "UNSUBSCRIBE_SECRET короче 32 символов"; fi

[[ "$(get STOREFRONT_REQUIRE_PAYOUTS)" == false ]] && err "STOREFRONT_REQUIRE_PAYOUTS=false — товары поставщиков без выплат попадут на витрину"

cap_s="$(get SMARTCAPTCHA_SERVER_KEY)"; cap_c="$(get SMARTCAPTCHA_CLIENT_KEY)"
[[ -n "$cap_s" && -z "$cap_c" || -z "$cap_s" && -n "$cap_c" ]] && err "SMARTCAPTCHA_SERVER_KEY и SMARTCAPTCHA_CLIENT_KEY задаются парой"

if (( DEMO )); then
  [[ "$(get ALLOW_TEST_PROVIDERS)" == 1 ]] || warn "демо-стенд без ALLOW_TEST_PROVIDERS=1 — API не стартует без боевых ключей"
  [[ "$(get SITE_NOINDEX)" == 1 ]] || warn "демо-стенд без SITE_NOINDEX=1 — откроется поисковикам"
  want DEMO_PASSWORD "пароль демо-входов"
else
  # Остатки демо-стенда
  [[ -n "$(get ALLOW_TEST_PROVIDERS)" ]] && err "ALLOW_TEST_PROVIDERS задан — тестовая оплата переведёт любой заказ в «оплачен»; удалить строку"
  [[ -n "$(get SITE_NOINDEX)" ]] && err "SITE_NOINDEX задан — сайт закрыт от поисковиков; удалить строку"
  [[ -n "$(get DEMO_PASSWORD)" ]] && warn "DEMO_PASSWORD задан — на боевом демо-входов быть не должно"

  # Оплата, доставка, почта — то же, что проверит API при старте
  [[ "$(get PAYMENTS_DRIVER)" == yookassa ]] || err "PAYMENTS_DRIVER должен быть yookassa"
  need YOOKASSA_SHOP_ID; need YOOKASSA_SECRET_KEY
  [[ "$(get YOOKASSA_SECRET_KEY)" == test_* ]] && err "YOOKASSA_SECRET_KEY — ключ тестового магазина (test_…)"
  [[ "$(get DELIVERY_DRIVER)" == cdek ]] || err "DELIVERY_DRIVER должен быть cdek"
  need CDEK_CLIENT_ID; need CDEK_CLIENT_SECRET
  [[ "$(get CDEK_API_URL)" == *edu.cdek* ]] && err "CDEK_API_URL — тестовый контур СДЭК (edu), боевой: https://api.cdek.ru/v2"
  [[ "$(get MAIL_DRIVER)" == smtp ]] || err "MAIL_DRIVER должен быть smtp"
  need SMTP_URL "письма покупателям и поставщикам"
  from="$(get MAIL_FROM)"
  if [[ -z "$from" || "$from" == *example.ru* ]]; then
    err "MAIL_FROM не задан (в образце example.ru)"
  elif [[ -n "$domain" && "$from" != *"$domain"* ]]; then
    warn "MAIL_FROM не на домене $domain — проверьте SPF/DKIM для домена отправителя"
  fi
  need ALERT_EMAIL "сбои вебхука ЮKassa и премиум-заявки"

  # Реквизиты оператора — на страницах /legal/*
  need OPERATOR_NAME "юридические страницы"; need OPERATOR_ADDRESS; need OPERATOR_EMAIL
  inn="$(get OPERATOR_INN)"; ogrn="$(get OPERATOR_OGRN)"
  [[ "$inn" =~ ^([0-9]{10}|[0-9]{12})$ ]] || err "OPERATOR_INN — 10 цифр (юрлицо) или 12 (ИП)"
  [[ "$ogrn" =~ ^([0-9]{13}|[0-9]{15})$ ]] || err "OPERATOR_OGRN — 13 цифр (ОГРН) или 15 (ОГРНИП)"

  # Желательно
  want TELEGRAM_BOT_TOKEN "уведомления поставщикам и служебные сообщения"
  want ALERT_TELEGRAM_CHAT_ID "сообщения о диске и бэкапах (ops/notify.sh)"
  want METRIKA_ID "аналитика пилота"
  want YMAPS_API_KEY "карта ПВЗ при оформлении"
  [[ -n "$cap_s" ]] || warn "SmartCaptcha не подключена — при превышении лимитов входа и регистрации формы отвечают 429"

  # Бэкап вне сервера — проверяется только на самом сервере
  if [[ -d /etc/aesculap ]]; then
    b=/etc/aesculap/backup.env
    if [[ ! -r "$b" ]]; then
      err "нет $b (или нет прав прочитать — запустите через sudo) — образец ops/backup.env.example"
    elif ! grep -qE '^S3_BUCKET=.+' "$b"; then
      err "в $b не задан S3_BUCKET — бэкап останется только на этом сервере"
    fi
  fi
fi

echo
if (( errors )); then
  echo "Ошибок: $errors, предупреждений: $warnings. Запускать рано."
  exit 1
fi
echo "Ошибок нет, предупреждений: $warnings."
