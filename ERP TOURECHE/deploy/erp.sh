#!/usr/bin/env bash
# إدارة ERP TOURECHE على الـ VPS (بعد التثبيت يكفي كتابة erp بدل bash deploy/erp.sh)
#   erp update            # جلب آخر نسخة من GitHub وإعادة البناء (البيانات لا تتأثر)
#   erp logs              # آخر السجلات
#   erp status            # الحالة
#   erp backup            # نسخة احتياطية الآن (تظهر في /data/backups وفي offsite/ إن ضُبط)
#   erp restore FILE.db   # استرجاع بيانات (مثلاً من الحاسوب) — يوقف الـ ERP ثم يعيده
#   erp import-key FILE   # وضع ملف .secret-key القديم (لمفاتيح الربط المشفّرة)
#   erp reset-password USER NEWPASS
#   erp setup-token       # رمز الإعداد الأول (يُطلب قبل إنشاء حساب المدير)
set -euo pipefail
# يعمل أيضاً عبر الرابط /usr/local/bin/erp
cd "$(dirname "$(readlink -f "$0")")"
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
  setup-token) docker exec erp-toureche cat /data/.setup-token 2>/dev/null || echo "لا يوجد رمز: الإعداد الأول تمّ" ;;
  *) sed -n '2,10p' "$(readlink -f "$0")" ;;
esac
