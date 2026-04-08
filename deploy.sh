#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=false

if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN (geen push) ==="
fi

echo "=== EPD Check starten ==="
cd "$REPO_DIR"
node check.js

if $DRY_RUN; then
  echo "=== Klaar (dry run, niet gepusht) ==="
  echo "Open dist/index.html om te bekijken."
  exit 0
fi

echo "=== Deployen naar gh-pages ==="
cd "$REPO_DIR/dist"

git init -q
git checkout -q -b gh-pages 2>/dev/null || git checkout -q gh-pages
git add -A
git commit -q -m "update: $(date '+%Y-%m-%d %H:%M')"
git push -q -f "https://github.com/schellevis/epdchecker.git" gh-pages

echo "=== Klaar ==="
