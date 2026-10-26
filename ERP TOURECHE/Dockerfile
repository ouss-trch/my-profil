# ERP TOURECHE — صورة Docker للتشغيل على VPS (بجانب n8n خلف Traefik)
# البيانات (قاعدة البيانات، المفتاح السري، النسخ الاحتياطية، الصور) في المجلد /data المربوط بـ volume

FROM node:22-bookworm-slim AS build
WORKDIR /app
# أدوات بناء better-sqlite3 إن لم تتوفر نسخته الجاهزة
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci && npm --prefix client ci
COPY . .
RUN npm --prefix client run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Traefik يصل من شبكة Docker الخاصة (172.x)، فنثق بالعناوين الخاصة كي يُحسب حدّ المحاولات على IP الزائر لا على Traefik
ENV NODE_ENV=production \
    ERP_DATA_DIR=/data \
    ERP_PORT=3600 \
    ERP_HOST=0.0.0.0 \
    ERP_TRUST_PROXY="loopback, uniquelocal" \
    TZ=Africa/Algiers
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3600
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3600/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
