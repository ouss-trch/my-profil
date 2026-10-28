#!/bin/bash
# حزم مهارات المستودع لرفعها في حساب Claude، فتتبع المالك في كل مشروع ومحادثة:
#   claude.ai ← Customize ← Skills ← «+» ← Create skill ← Upload a skill
# كل مهارة ملف ZIP فيه مجلدها في الجذر (اسم المجلد = اسم المهارة)، كما يطلب Claude.
# يفحص قبل الحزم ما يرفضه الرفع: حقول الرأس الستة المسموحة، الاسم، الوصف (1024 حرفاً).
# الاستعمال: bash scripts/pack-skills.sh              ← المهارات المقترحة
#            bash scripts/pack-skills.sh copywriting  ← مهارات محددة
# الناتج في dist-skills/ (لا يُرفع إلى GitHub).
set -e
cd "$(dirname "$0")/.."
python3 - "$@" <<'PY'
import os, re, sys, zipfile

root = os.path.abspath(os.path.join('..', '.claude', 'skills'))
out = os.path.abspath('dist-skills')
names = sys.argv[1:] or ['cod-landing-page-builder', 'ecommerce-erp-builder', 'find-skills', 'copywriting', 'marketing-psychology', 'ad-creative']
ALLOWED = {'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'}
SKIP = {'.git', '.DS_Store', '__pycache__', 'node_modules'}


def frontmatter(text):
    m = re.match(r'---\r?\n(.*?)\r?\n---\r?\n', text, re.S)
    if not m:
        raise ValueError('SKILL.md must start with a --- frontmatter block')
    fields, key = {}, None
    for line in m.group(1).splitlines():
        top = re.match(r'([A-Za-z][\w-]*):\s?(.*)$', line)
        if top and not line.startswith((' ', '\t')):
            key, value = top.group(1), top.group(2).strip()
            fields[key] = '' if value in ('>', '|', '>-', '|-') else value.strip('"\'')
        elif key and line.strip():
            fields[key] = (fields[key] + ' ' + line.strip()).strip()
    return fields


def check(name, folder):
    f = frontmatter(open(os.path.join(folder, 'SKILL.md'), encoding='utf-8').read())
    extra = sorted(set(f) - ALLOWED)
    if extra:
        raise ValueError(f'frontmatter keys claude.ai refuses: {", ".join(extra)} (allowed: {", ".join(sorted(ALLOWED))})')
    n, d = f.get('name', ''), f.get('description', '')
    if n != name:
        raise ValueError(f'name "{n}" must equal the folder name "{name}"')
    if len(n) > 64 or not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', n) or re.search(r'anthropic|claude', n):
        raise ValueError('name: up to 64 lowercase letters, digits and hyphens, without "anthropic" or "claude"')
    if not d or len(d) > 1024 or re.search(r'<[A-Za-z/][^>]*>', d):
        raise ValueError(f'description: 1 to 1024 characters without XML tags (now {len(d)})')


os.makedirs(out, exist_ok=True)
failed = False
for name in names:
    folder = os.path.join(root, name)
    try:
        if not os.path.isfile(os.path.join(folder, 'SKILL.md')):
            raise ValueError(f'no SKILL.md in .claude/skills/{name}')
        check(name, folder)
        target = os.path.join(out, f'{name}.zip')
        if os.path.exists(target):
            os.remove(target)
        count = 0
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
            for base, dirs, files in os.walk(folder):
                dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith('.'))
                for file in sorted(files):
                    if file in SKIP or file.startswith('.') or file.endswith('.pyc'):
                        continue
                    path = os.path.join(base, file)
                    z.write(path, os.path.join(name, os.path.relpath(path, folder)))
                    count += 1
        print(f'ok  dist-skills/{name}.zip  {count} files  {os.path.getsize(target) // 1024 + 1} KB')
    except Exception as e:
        failed = True
        print(f'ERR {name}: {e}', file=sys.stderr)
sys.exit(1 if failed else 0)
PY
