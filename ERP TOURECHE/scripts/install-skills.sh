#!/bin/bash
# تثبيت المهارات المرجعية في ~/.claude/skills (تُراجع قبل الاستعمال — لا تشغّل كوداً لم تقرأه)
set -e
DEST="${HOME}/.claude/skills"
mkdir -p "$DEST" && cd "$(mktemp -d)"
for repo in anthropics/skills obra/superpowers coreyhaines31/marketingskills nextlevelbuilder/ui-ux-pro-max-skill czlonkowski/n8n-skills trailofbits/skills; do
  echo "→ $repo"
  git clone --depth 1 "https://github.com/$repo.git" "$(basename "$repo")" >/dev/null 2>&1 || { echo "  تعذّر الاستنساخ"; continue; }
  find "$(basename "$repo")" -name SKILL.md -maxdepth 4 | while read -r f; do
    d=$(dirname "$f"); name=$(basename "$d"); [ -d "$DEST/$name" ] || cp -r "$d" "$DEST/$name"
  done
done
echo "تم. المهارات في $DEST"
