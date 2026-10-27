#!/usr/bin/env bash
# Builds Retail and Bullion into ONE static site:  dist/retail/  dist/bullion/  dist/index.html
# Used by Vercel (see vercel.json). API address comes from VITE_API_BASE.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$ROOT/dist" && mkdir -p "$ROOT/dist"
for app in retail bullion; do
  echo "=== building $app"
  cd "$ROOT/frontend-$app"
  npm ci --no-audit --no-fund
  VITE_BASE="/$app/" npx vite build --outDir "$ROOT/dist/$app" --emptyOutDir
done
cp "$ROOT/landing/index.html" "$ROOT/dist/index.html"
echo "=== done"; ls "$ROOT/dist"
