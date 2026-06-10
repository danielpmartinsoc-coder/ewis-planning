#!/bin/bash
# Layer 2 — Daily git commit of all data files
# Runs via launchd at 02:00 every day.
set -e
cd "$(dirname "$0")/.."

# Only commit if there are actual changes
if git diff --quiet data/ && git diff --cached --quiet data/; then
  echo "$(date): No changes in data/ — skipping commit."
  exit 0
fi

git add data/*.json
git commit -m "chore: auto-backup $(date '+%Y-%m-%d %H:%M')"
echo "$(date): Backup commit created."
