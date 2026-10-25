#!/bin/bash
# تشغيل ERP TOURECHE على Linux/macOS (أول مرة: يثبّت ويبني تلقائياً)
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ثبّت Node.js 22 أو أحدث من https://nodejs.org"; exit 1; }
[ -d node_modules ] && [ -d client/dist ] || npm run setup
exec npm start
