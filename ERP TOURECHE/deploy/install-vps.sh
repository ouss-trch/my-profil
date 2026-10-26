#!/usr/bin/env bash
# تثبيت ERP TOURECHE على VPS بجانب n8n (Docker + Traefik الموجودان) — لا يلمس حاوية n8n.
# الاستعمال (من مجلد ERP TOURECHE على الـ VPS):  bash deploy/install-vps.sh erp.souqnna.com
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "الاستعمال: bash deploy/install-vps.sh erp.example.com"; exit 1; }
command -v docker >/dev/null || { echo "✗ Docker غير مثبت على هذا الخادم"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ docker compose غير متوفر"; exit 1; }

# 1) نقرأ إعداد Traefik من حاوية n8n نفسها (الشبكة، entrypoints، certresolver) حتى يعمل الـ ERP بنفس الطريقة
N8N=$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /n8n/ {print $1; exit}')
TRAEFIK=$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /traefik/ {print $1; exit}')
[ -n "$TRAEFIK" ] || { echo "✗ لم أجد حاوية Traefik تعمل. الحاويات الحالية:"; docker ps --format '  {{.Names}}  ({{.Image}})'; exit 1; }
[ -n "$N8N" ] || { echo "✗ لم أجد حاوية n8n تعمل (نقرأ منها إعداد Traefik)."; exit 1; }

LABELS=$(docker inspect -f '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' "$N8N")
RESOLVER=$(printf '%s\n' "$LABELS" | sed -n 's/^traefik\.http\.routers\.\([^.]*\)\.tls\.certresolver=\(.*\)$/\2/p' | head -1)
SECURE_ROUTER=$(printf '%s\n' "$LABELS" | sed -n 's/^traefik\.http\.routers\.\([^.]*\)\.tls\.certresolver=.*$/\1/p' | head -1)
ENTRY_HTTPS=$(printf '%s\n' "$LABELS" | sed -n "s/^traefik\.http\.routers\.${SECURE_ROUTER:-_none_}\.entrypoints=//p" | head -1)
ENTRY_HTTP=$(printf '%s\n' "$LABELS" | grep '^traefik\.http\.routers\.[^.]*\.entrypoints=' | grep -v "routers\.${SECURE_ROUTER:-_none_}\." | sed 's/^.*entrypoints=//' | head -1)
NETWORK=$(printf '%s\n' "$LABELS" | sed -n 's/^traefik\.docker\.network=//p' | head -1)
if [ -z "$NETWORK" ]; then
  # الشبكة المشتركة بين Traefik و n8n
  for net in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$N8N"); do
    if docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$TRAEFIK" | tr ' ' '\n' | grep -qx "$net"; then NETWORK="$net"; break; fi
  done
fi
[ -n "$RESOLVER" ] || { echo "✗ لم أجد certresolver في إعداد n8n. أرسل ناتج: docker inspect $N8N"; exit 1; }
[ -n "$NETWORK" ] || { echo "✗ لم أجد شبكة مشتركة بين Traefik و n8n."; exit 1; }
ENTRY_HTTPS=${ENTRY_HTTPS:-websecure}
ENTRY_HTTP=${ENTRY_HTTP:-web}

echo "✓ Traefik: $TRAEFIK · n8n: $N8N"
echo "✓ الشبكة: $NETWORK · HTTPS: $ENTRY_HTTPS · HTTP: $ENTRY_HTTP · الشهادة: $RESOLVER"

# 2) الدومين يجب أن يشير إلى هذا الخادم (سجل A) وإلا لن تصدر شهادة HTTPS
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' | head -1 || true)
IP=${IP:-$(hostname -I 2>/dev/null | awk '{print $1}' || true)}
DNS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)
if [ "$DNS" != "$IP" ]; then
  echo "⚠ $DOMAIN يشير إلى «${DNS:-لا شيء}» وعنوان هذا الخادم $IP."
  echo "  أضف سجل A: الاسم = الجزء الأول من الدومين (مثل erp) ← $IP، ثم أعد تشغيل هذا السكربت."
  read -r -p "  المتابعة على أي حال؟ (y/N) " ans
  [ "${ans:-N}" = "y" ] || exit 1
fi

# 3) الإعداد (لا يُرفع إلى git) ثم البناء والتشغيل
# مجلد النسخ خارج الحاوية (يمكن مزامنته مع Google Drive بـ rclone)؛ الحاوية تعمل بالمستخدم node (uid 1000)
mkdir -p offsite && chown 1000:1000 offsite
cat > .env <<ENV
ERP_DOMAIN=$DOMAIN
TRAEFIK_NETWORK=$NETWORK
TRAEFIK_ENTRY_HTTP=$ENTRY_HTTP
TRAEFIK_ENTRY_HTTPS=$ENTRY_HTTPS
TRAEFIK_CERTRESOLVER=$RESOLVER
ENV
docker compose --env-file .env up -d --build

# 4) التحقق
echo "… انتظار تشغيل الـ ERP"
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' erp-toureche 2>/dev/null || true)
  [ "$st" = "healthy" ] && break
  sleep 2
done
[ "$st" = "healthy" ] || { echo "✗ الـ ERP لم يبدأ. السجل:"; docker logs --tail 40 erp-toureche; exit 1; }
echo ""
echo "✓ الـ ERP يعمل على الخادم 24/7"
echo "  افتح: https://$DOMAIN  (أول مرة: حساب المدير + كلمة المرور الحساسة + أول مشروع)"
TOKEN=$(docker exec erp-toureche cat /data/.setup-token 2>/dev/null || true)
[ -z "$TOKEN" ] || echo "  رمز الإعداد الأول (اكتبه في صفحة الإعداد): $TOKEN"
echo "  من n8n داخل نفس الخادم استعمل: http://erp-toureche:3600/api/hooks/<slug>/orders"
echo "  التحديث لاحقاً: bash deploy/erp.sh update"
