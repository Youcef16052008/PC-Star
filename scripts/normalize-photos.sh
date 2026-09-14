#!/bin/bash
# Normalise toutes les photos catalogue (sku/ + lib/) vers un rendu studio
# homogène : fond clair unique #eef2fa, ratio 4:3, padding constant,
# bandes letterbox supprimées, transparence aplatie. Régénère les .webp.
set -u
cd "$(dirname "$0")/../public/photos" || exit 1
BG='#ffffff'
count=0
for f in sku/*.jpg lib/*.jpg; do
  [ -f "$f" ] || continue
  out="/tmp/norm_$$.jpg"
  convert "$f" \
    -background "$BG" -alpha remove -alpha off \
    -fuzz 9% -trim +repage \
    -resize '1056x792' \
    -background "$BG" -gravity center -extent 1200x900 \
    -strip -interlace JPEG -quality 85 "$out" 2>/dev/null
  if [ -s "$out" ]; then
    mv "$out" "$f"
    w="${f%.jpg}.webp"
    convert "$f" -strip -quality 78 "$w" 2>/dev/null || rm -f "$w"
    count=$((count + 1))
  else
    rm -f "$out"
  fi
done
echo "NORMALIZE DONE — $count photos"
