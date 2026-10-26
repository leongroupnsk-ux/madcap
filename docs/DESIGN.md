# Вёрстка по макету Figma

Источник — копия макета «МедКапсула» в Figma: файл `UePMePozZrEyKIc8Ma08Jq` (оригинал `00JNyGepfBhAgx6GBGcaSF` доступен только на просмотр — MCP с ним не работает). Кадры шириной 1549 px, контейнер контента 1320 px с полями 32 px.

## Правила

- Перед `get_design_context` загрузить скилл `figma:figma-design-to-code` (Skill) и передавать `skillNames: "figma-design-to-code"`.
- Большие кадры (> 100 КБ кода) брать по секциям: структура — `get_metadata` по id кадра, затем `get_design_context` по дочерним узлам.
- Код из Figma — React + Tailwind; в проекте **CSS Modules**, Tailwind не ставить. Абсолютное позиционирование переводить во flex/grid.
- Ассеты (фото, SVG) скачивать `curl -L` сразу — ссылки живут 7 дней. Статика макета — `apps/web/public/design/` (иконки — `design/icons/`). Фото конвертировать в WebP (sharp есть в `apps/api`), длинная сторона до ~1600 px.
- Фото товаров — это демо-данные, а не вёрстка: они идут в демо-каталог (`apps/api/prisma/demo.ts`, файлы — `apps/api/prisma/demo-assets/*.webp`), а не в разметку.
- Логику не менять: формы, API, валидация, доступы остаются как есть. Меняется только внешний вид, тексты — как в макете, если они не противоречат данным.
- Адаптив обязателен: макет только десктопный, мобильные варианты — свои, в том же стиле. Проверять 1549, 1024, 768, 360; без горизонтальной прокрутки страницы.
- Проверка: открыть страницу на `http://localhost:4000` во встроенном браузере с окном 1549×1000 и сравнить со скриншотом кадра из `get_design_context`. После — вернуть окно (`resize_window preset desktop`).
- `cd apps/web && npx tsc --noEmit -p .` должен проходить. Если трогался API — `cd apps/api && npx vitest run`.

## Токены (`apps/web/src/app/tokens.css`)

| Что | Значение |
| --- | --- |
| Фон страницы | `--c-bg` #f7f4ed |
| Основной (кнопки, заголовки) | `--c-primary` #123d32 |
| Акцент (главные CTA, выделенное слово) | `--c-accent` #f3ae79 |
| Распродажа, точка в логотипе | `--c-sale` #d95c40 |
| Карточка товара | `--c-surface-soft` #ecf1ed, рамка `--c-border-soft` |
| Мятные плашки | `--c-surface-mint` #e3eee8, чип `--c-chip` #e0eee7 |
| Текст | основной #123d32, абзацы `--c-text-body` #40594d, меню `--c-text-nav` #45544d, вторичный `--c-text-muted` #607168, бренд/подписи `--c-text-faint` #73867d |
| Шрифты | заголовки `--font-serif` Prata (h1/h2 трекинг −0.055em), текст `--font-sans` Manrope, надзаголовки `--font-mono` JetBrains Mono (вместо DM Mono макета — в нём нет кириллицы) 10 px / трекинг 0.15em (класс `.eyebrow`), блок «Премиум» `--font-display` Playfair Display |
| Радиусы | карточки 16 px (`--r-md`), крупные блоки 24 px (`--r-lg`), кнопки — пилюля |

Готовые общие части: `components/SiteHeader.tsx`, `components/SiteFooter.tsx`, `components/Logo.tsx`, `components/shop/ProductCard.tsx` (компонент product-card), главная `app/(shop)/page.tsx` — образец переноса.

## Кадры

| Кадр (id) | Страница |
| --- | --- |
| .Main 1:2 | `/` — готово |
| .Catalog 25:2146, .Catalog-rope 175:2711, filter 25:3346 | `/catalog`, `/catalog/[cat]` |
| .Product card 1:4356, table-of-sizes 130:2652, table-of-sizes-shoes 328:2976 | `/product/[slug]` |
| .Quiz-step-1…6 (4:952, 1:1938, 1:2028, 1:2196, 1:2284, 1:2341), .Review 1:2416, .Quiz-success 1:2545 | `/quiz/*` |
| .Capsule 15:619, capsule-product-card 15:906, change-product 19:1349 | `/capsule` |
| .Cart 1:3259, .Cart-null 32:4943, button-in-cart 32:4840 | `/cart` |
| .Order-step-1 19:1561, .Order-step-2 1:3713, cdek-* (185:3419, 183:3257, 185:3555, 185:3687, 175:3100), .Order-success 1:3835 | `/checkout`, результат оплаты |
| .Profile - Main 1:4920, .Profile - Order 1:5039 | `/account`, `/account/orders/[n]` |
| .Articles 1:5511, .Articles-Article 28:4015, .Articles-Selection 28:4343 | `/journal`, статья, подборка |
| .Auth 1:5678, .Auth-Forget-password-1/2 (1:5732, 32:5175), .Auth-Register 1:5767 | вход, сброс пароля, регистрация |
| .Premium 212:2806, .Premium-capsule 254:3572, .Premium-Quiz-1…7 + success, premium-call-me 290:4335 | `/premium` и премиальный подбор |
| .Partner-* (Auth 1:5823, Auth-Request 51:6144, Main 1:5879, Products 1:6556, Products-Product 1:7607, New product 68:3075, new-variant 68:3345, Imports 1:7282, Orders 1:8500, Orders-Order 1:8732, Content 1:8880, New article 1:8980, Content-Article 1:9235, Content-New pop 1:9599, Content-Pop 1:9823, Set 4:126, Sales 83:5623, Cash 86:6744), supplier-shell 62:2394 | кабинет поставщика `/supplier/*` |
| Sitemap 149:2656 | `/map` («Карта платформы») |
