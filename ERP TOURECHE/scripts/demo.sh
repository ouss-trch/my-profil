#!/bin/bash
# تشغيل نسخة عرض (بيانات تجريبية) — للتجربة فقط، ليست نسخة الإنتاج
set -e
cd "$(dirname "$0")/.."
export ERP_DATA_DIR="${ERP_DATA_DIR:-$PWD/demo-data}" ERP_PORT="${ERP_PORT:-3600}" ERP_DISABLE_SCHEDULER=1
mkdir -p "$ERP_DATA_DIR"
nohup node server/index.js > "$ERP_DATA_DIR/server.log" 2>&1 &
for i in $(seq 1 30); do curl -sf "localhost:$ERP_PORT/api/health" >/dev/null && break; sleep 1; done
if curl -s "localhost:$ERP_PORT/api/auth/status" | grep -q '"setup_required":true'; then
  curl -s -H 'Content-Type: application/json' -d "{\"username\":\"demo\",\"password\":\"${DEMO_PASSWORD}\",\"sensitive_password\":\"${DEMO_SENSITIVE}\",\"display_name\":\"Demo\",\"project_name\":\"SOU9NA (demo)\",\"project_domain\":\"souqnna.com\"}" "localhost:$ERP_PORT/api/auth/setup" > /dev/null
  node scripts/seed-demo.mjs "$PWD"
fi
echo "demo ready on :$ERP_PORT"
