#!/usr/bin/env bash
# إدارة ERP TOURECHE على الـ VPS
#   bash deploy/erp.sh update            # جلب آخر نسخة من GitHub وإعادة البناء (البيانات لا تتأثر)
#   bash deploy/erp.sh logs              # آخر السجلات
#   bash deploy/erp.sh status            # الحالة
#   bash deploy/erp.sh backup            # نسخة احتياطية الآن (تظهر في /data/backups وفي offsite/ إن ضُبط)
#   bash deploy/erp.sh restore FILE.db   # استرجاع بيانات (مثلاً من الحاسوب) — يوقف الـ ERP ثم يعيده
#   bash deploy/erp.sh import-key FILE   # وضع ملف .secret-key القديم (لمفاتيح الربط المشفّرة)
#   bash deploy/erp.sh reset-password USER NEWPASS
set -euo pipefail
cd "$(dirname "$0")"
C="docker compose --env-file .env"
[ -f .env ] || { echo "✗ شغّل install-vps.sh أولاً"; exit 1; }

case "${1:-}" in
  update)
    git -C .. pull --ff-only
    $C up -d --build
    docker image prune -f >/dev/null
    $C ps ;;
  logs) docker logs --tail "${2:-100}" -f erp-toureche ;;
  status) $C ps; docker inspect -f 'الحالة: {{.State.Health.Status}}' erp-toureche ;;
  backup) docker exec erp-toureche node -e "import('./server/services/backup.js').then((m) => m.backup({ force: true })).then((r) => console.log('✓', r.file, r.mirrored ? '+ ' + r.mirrored : '', r.mirrorError || ''))" ;;
  restore)
    f="${2:?ملف النسخة الاحتياطية}"; [ -f "$f" ] || { echo "✗ الملف غير موجود: $f"; exit 1; }
    $C stop erp
    # يُعاد تشغيل الـ ERP في كل الحالات، حتى إن رُفضت النسخة
    rc=0; $C run --rm --no-deps -v "$(realpath "$f"):/import.db:ro" erp node server/cli.js restore /import.db || rc=$?
    $C start erp
    exit $rc ;;
  import-key)
    f="${2:?ملف .secret-key}"; [ -f "$f" ] || { echo "✗ الملف غير موجود: $f"; exit 1; }
    $C stop erp
    rc=0; $C run --rm --no-deps -v "$(realpath "$f"):/key:ro" --entrypoint sh erp -c 'cp /key /data/.secret-key && chmod 600 /data/.secret-key' || rc=$?
    $C start erp
    [ $rc -eq 0 ] && echo "✓ وُضع المفتاح"
    exit $rc ;;
  reset-password) docker exec erp-toureche node server/cli.js reset-password "${2:?}" "${3:?}" ;;
  *) sed -n '2,9p' "$0" ;;
esac
