#!/usr/bin/env bash
# إدارة ERP TOURECHE على الـ VPS (بعد التثبيت يكفي كتابة erp بدل bash deploy/erp.sh)
#   erp update            # نسخة احتياطية ← آخر نسخة من GitHub ← بناء ← فحص التشغيل (رجوع تلقائي إن فشل). البيانات لا تتأثر
#   erp logs              # آخر السجلات
#   erp status            # الحالة
#   erp backup            # نسخة احتياطية الآن (تظهر في /data/backups وفي offsite/ إن ضُبط)
#   erp restore FILE.db   # استرجاع بيانات (مثلاً من الحاسوب) — يوقف الـ ERP ثم يعيده
#   erp import-key FILE   # وضع ملف .secret-key القديم (لمفاتيح الربط المشفّرة)
#   erp reset-password USER NEWPASS
#   erp setup-token       # رمز الإعداد الأول (يُطلب قبل إنشاء حساب المدير)
# زر «تحديث الآن» داخل الـ ERP (الإعدادات ← النظام) يستعمل نفس update: الحاوية تكتب طلباً في مجلد
# التبادل، وخدمة systemd على الخادم (erp-updater) تنفّذه. تُثبَّت تلقائياً مع كل update.
set -euo pipefail
# يعمل أيضاً عبر الرابط /usr/local/bin/erp
SELF="$(readlink -f "$0")"
cd "$(dirname "$SELF")"
C="docker compose --env-file .env"
[ -f .env ] || { echo "✗ شغّل install-vps.sh أولاً"; exit 1; }

# مجلد التبادل مع الحاوية: inbox (الحاوية تكتب الطلبات) و state (الخادم يكتب النتائج، والحاوية تقرؤها فقط)
UPD="${ERP_UPDATER_DIR:-/var/lib/erp-updater}"
LOCK="${ERP_LOCK_FILE:-/run/erp-update.lock}"
HEALTH_TIMEOUT="${ERP_HEALTH_TIMEOUT:-240}"
export ERP_UPDATER_DIR="$UPD"
now() { date -Iseconds; }
oneline() { printf '%s' "$*" | tr '\n\r\t' '   ' | cut -c1-300; }

# ملف حالة يُكتب كاملاً ثم يحلّ محل القديم (الواجهة لا تقرأ نصف ملف)
put() {
  local f="$UPD/state/$1" tmp
  shift
  tmp="$(mktemp "$UPD/state/.tmp.XXXXXX")"
  printf '%s\n' "$@" >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$f"
}

prepare_dirs() {
  mkdir -p "$UPD/inbox" "$UPD/state"
  # الحاوية تعمل بالمستخدم node (uid 1000): تكتب في inbox فقط
  chown 1000:1000 "$UPD/inbox" 2>/dev/null || true
  chmod 755 "$UPD/state"
}

install_units() {
  local d="${ERP_SYSTEMD_DIR:-/etc/systemd/system}"
  command -v systemctl >/dev/null && [ -w "$d" ] || return 0
  cat >"$d/erp-updater.service" <<UNIT
[Unit]
Description=ERP TOURECHE: update from the ERP button, and check for new versions
After=docker.service
[Service]
Type=oneshot
Environment=HOME=/root
Environment=ERP_UPDATER_DIR=$UPD
ExecStart=/bin/bash "$SELF" agent
TimeoutStartSec=40min
UNIT
  cat >"$d/erp-updater.path" <<UNIT
[Unit]
Description=ERP TOURECHE: watch for requests from the ERP
[Path]
PathExists=$UPD/inbox/update
PathExists=$UPD/inbox/check
Unit=erp-updater.service
[Install]
WantedBy=multi-user.target
UNIT
  cat >"$d/erp-updater.timer" <<UNIT
[Unit]
Description=ERP TOURECHE: look for a new version every 6 hours
[Timer]
OnBootSec=3min
OnUnitActiveSec=6h
Unit=erp-updater.service
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload 2>/dev/null && systemctl enable --now erp-updater.path erp-updater.timer >/dev/null 2>&1 ||
    echo "⚠ تعذّر تفعيل خدمة erp-updater (زر التحديث داخل الـ ERP)"
}

# النسخة التي تعمل فعلاً (مكتوبة داخل الصورة عند البناء)، وإلا آخر commit محلي
running_commit() {
  local c
  c="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' erp-toureche 2>/dev/null | sed -n 's/^ERP_COMMIT=//p' | head -1 || true)"
  if [ -n "$c" ] && git -C .. cat-file -e "$c^{commit}" 2>/dev/null; then echo "$c"; else git -C .. rev-parse HEAD; fi
}

# هل توجد نسخة أحدث على GitHub؟ (التغييرات داخل مجلد ERP TOURECHE فقط)
check() {
  local err="" up="" base remote behind=0
  prepare_dirs
  base="$(running_commit)"
  remote="$base"
  err="$(git -C .. fetch --quiet 2>&1)" && err=""
  if up="$(git -C .. rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    remote="$(git -C .. rev-parse "$up")"
    behind="$(git -C .. rev-list --count "$base..$remote" -- .)"
  else
    err="${err:-no_upstream}"
  fi
  local lines=("checked_at=$(now)" "branch=$up" "running=$base" "remote=$remote" "behind=$behind" "error=$(oneline "$err")")
  while IFS= read -r l; do [ -n "$l" ] && lines+=("c=$l"); done < <(git -C .. log --format='%h%x1f%cI%x1f%s' -n 15 "$base..$remote" -- . 2>/dev/null || true)
  put check "${lines[@]}"
  put agent "version=1" "seen_at=$(now)" "branch=$up"
  echo "✓ فحص: $behind تغيير جديد"
}

# حالة التحديث الجاري: running | ok | failed
ustate() { put update "state=$1" "step=$2" "error=${3:-}" "started_at=$U_START" "finished_at=${4:-}" "from=$U_FROM" "to=${U_TO:-}" "by=$U_BY"; }
fail() {
  U_DONE=1
  ustate failed "$1" "$2" "$(now)"
  echo "✗ $2 (السجل: $LOG)"
  exit 1
}
on_exit() { [ "${U_DONE:-0}" = 1 ] || ustate failed "${U_STEP:-?}" interrupted "$(now)"; }
step() {
  U_STEP="$1"
  ustate running "$1"
  echo "→ $1" | tee -a "$LOG"
}

health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' erp-toureche 2>/dev/null || echo missing; }
wait_healthy() {
  local s waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    s="$(health)"
    [ "$s" = healthy ] && return 0
    [ "$s" = unhealthy ] && return 1
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# المرحلة 1: نسخة احتياطية ثم جلب الكود (بالسكربت الحالي)
update() {
  export U_START U_FROM U_BY LOG U_TO=""
  U_START="$(now)"
  U_FROM="$(running_commit)"
  U_BY="${1:-ssh}"
  LOG="$UPD/state/log"
  prepare_dirs
  : >"$LOG"
  trap on_exit EXIT
  step backup
  if [ "$(docker inspect -f '{{.State.Running}}' erp-toureche 2>/dev/null || true)" = true ]; then
    docker exec erp-toureche node -e "import('./server/services/backup.js').then((m) => m.backup({ force: true })).then((r) => console.log('✓', r.file))" 2>&1 | tee -a "$LOG" || fail backup backup_failed
  else
    echo "الـ ERP متوقف: لا نسخة احتياطية قبل التحديث" | tee -a "$LOG"
  fi
  step pull
  git -C .. pull --ff-only 2>&1 | tee -a "$LOG" || fail pull pull_failed
  # بقية الخطوات من السكربت الجديد نفسه (قد يكون تغيّر مع هذا التحديث)
  U_DONE=1
  exec bash "$SELF" _rebuild
}

# المرحلة 2: بناء ← تشغيل ← فحص، ورجوع للصورة السابقة إن لم يشتغل
rebuild() {
  U_TO="$(git -C .. rev-parse HEAD)"
  trap on_exit EXIT
  prepare_dirs
  install_units
  step build
  export ERP_COMMIT="$U_TO" ERP_BUILT_AT="$(now)"
  ERP_COMMIT_DATE="$(git -C .. log -1 --format=%cI)"
  ERP_COMMIT_SUBJECT="$(git -C .. log -1 --format=%s)"
  export ERP_COMMIT_DATE ERP_COMMIT_SUBJECT
  local prev=0
  docker image inspect erp-toureche:latest >/dev/null 2>&1 && docker tag erp-toureche:latest erp-toureche:previous && prev=1
  $C build erp 2>&1 | tee -a "$LOG" || fail build build_failed
  step restart
  $C up -d 2>&1 | tee -a "$LOG" || fail restart restart_failed
  step verify
  if ! wait_healthy; then
    echo "النسخة الجديدة لم تشتغل ($(health)). آخر السجلات:" | tee -a "$LOG"
    docker logs --tail 40 erp-toureche >>"$LOG" 2>&1 || true
    [ "$prev" = 1 ] || fail verify rollback_failed
    docker tag erp-toureche:previous erp-toureche:latest
    $C up -d 2>&1 | tee -a "$LOG" || true
    wait_healthy || fail verify rollback_failed
    fail verify rolled_back
  fi
  docker image prune -f >/dev/null 2>&1 || true
  U_DONE=1
  ustate ok done "" "$(now)"
  echo "✓ تم التحديث إلى $(git -C .. log -1 --format='%h %s')" | tee -a "$LOG"
  check >/dev/null || true
}

lock() {
  exec 9>"$LOCK"
  # ننتظر بدل الرفض: طلب من الزر أثناء update من SSH يُنفَّذ بعده
  flock 9
}

main() {
  case "${1:-}" in
    update)
      lock
      update ssh ;;
    agent)
      lock
      prepare_dirs
      if [ -e "$UPD/inbox/update" ]; then
        rm -f "$UPD/inbox/update" "$UPD/inbox/check"
        update ui
      else
        rm -f "$UPD/inbox/check"
        check
      fi ;;
    _rebuild) rebuild ;;
    check) check ;;
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
    *) sed -n '2,12p' "$SELF" ;;
  esac
}

# سطر واحد: bash يقرؤه كاملاً قبل التنفيذ، فتغيّر هذا الملف أثناء التحديث لا يؤثر على ما بعده
main "$@"; exit
