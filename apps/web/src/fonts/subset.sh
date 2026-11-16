#!/usr/bin/env bash
# Уменьшенные наборы шрифтов для витрины (docs/PERF.md, «Этап 3»). Исходники — файлы Google Fonts рядом
# (*-latin.woff2, *-cyrillic.woff2, *-latin-ext.woff2); результат — файлы с суффиксами, их и подключают index.ts и playfair.ts.
# Нужен fonttools: python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli && PY=/tmp/ft/bin/python src/fonts/subset.sh
#
# - JetBrains Mono: набор latin делится на «знаки» (пробел, цифры, пунктуация — нужны каждому надзаголовку) и «буквы»
#   (грузятся, только если в моноширинном тексте есть латиница). Без calt — программистских лигатур (=>, !=, www),
#   на витрине они не нужны и занимали ~70 % файла.
# - Playfair Display: на сайте только начертание 400 (заголовки «Премиум»), из вариативного шрифта берётся статичное 400;
#   latin делится на «знаки» и «буквы» так же.
# - Manrope: знак ₽ отдельным файлом (1 КБ) — раньше ради него грузился весь latin-ext (15 КБ).
set -euo pipefail
cd "$(dirname "$0")"
PY="${PY:-python3}"
SUB=("$PY" -m fontTools.subset)

# Диапазоны должны совпадать с unicode-range в index.ts и playfair.ts
CORE='U+0000-0040,U+005B-0060,U+007B-007E,U+00A0,U+00AB,U+00B0,U+00B7,U+00BB,U+2000-206F,U+2212'
LETTERS='U+0041-005A,U+0061-007A,U+007F-009F,U+00A1-00AA,U+00AC-00AF,U+00B1-00B6,U+00B8-00BA,U+00BC-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+20AC,U+2122,U+2191,U+2193,U+2215,U+FEFF,U+FFFD'

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# JetBrains Mono
"${SUB[@]}" jetbrains-mono/jetbrains-mono-latin.woff2 --unicodes="$CORE" --layout-features-=calt --flavor=woff2 --output-file=jetbrains-mono/jetbrains-mono-latin-core.woff2
"${SUB[@]}" jetbrains-mono/jetbrains-mono-latin.woff2 --unicodes="$LETTERS" --layout-features-=calt --flavor=woff2 --output-file=jetbrains-mono/jetbrains-mono-latin-letters.woff2

# Playfair Display: статичное 400
for set in latin cyrillic latin-ext; do
  "$PY" -m fontTools.varLib.instancer "playfair/playfair-$set.woff2" wght=400 -q -o "$tmp/playfair-$set.ttf"
done
"${SUB[@]}" "$tmp/playfair-latin.ttf" --unicodes="$CORE" --layout-features='*' --flavor=woff2 --output-file=playfair/playfair-400-latin-core.woff2
"${SUB[@]}" "$tmp/playfair-latin.ttf" --unicodes="$LETTERS" --layout-features='*' --flavor=woff2 --output-file=playfair/playfair-400-latin-letters.woff2
"${SUB[@]}" "$tmp/playfair-cyrillic.ttf" --unicodes='*' --layout-features='*' --flavor=woff2 --output-file=playfair/playfair-400-cyrillic.woff2
"${SUB[@]}" "$tmp/playfair-latin-ext.ttf" --unicodes='*' --layout-features='*' --flavor=woff2 --output-file=playfair/playfair-400-latin-ext.woff2

# Manrope: ₽
"${SUB[@]}" manrope/manrope-latin-ext.woff2 --unicodes=U+20BD --layout-features='*' --flavor=woff2 --output-file=manrope/manrope-rub.woff2

ls -l jetbrains-mono/*-core.woff2 jetbrains-mono/*-letters.woff2 playfair/playfair-400-*.woff2 manrope/manrope-rub.woff2 | awk '{print $5, $NF}'
