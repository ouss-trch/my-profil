import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ملف .env اختياري في جذر المشروع (Node ≥ 22 يقرأه دون مكتبات إضافية)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const DATA_DIR = path.resolve(ROOT, env.ERP_DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

/** مفتاح التشفير الرئيسي: من .env أو يُولَّد مرة واحدة ويُحفظ في data/.secret-key (لا يُرفع إلى git) */
function masterKey() {
  if (env.ERP_SECRET_KEY) return crypto.createHash('sha256').update(env.ERP_SECRET_KEY).digest();
  const file = path.join(DATA_DIR, '.secret-key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}

export const config = {
  port: Number(env.ERP_PORT || env.PORT || 3600),
  host: env.ERP_HOST || '0.0.0.0',
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'toureche.db'),
  uploadsDir: path.join(DATA_DIR, 'uploads'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  // نسخة ثانية خارج الجهاز: مجلد متزامن مع السحابة (Google Drive / OneDrive / iCloud)
  backupMirrorDir: env.ERP_BACKUP_MIRROR ? path.resolve(env.ERP_BACKUP_MIRROR.replace(/^~(?=$|[\\/])/, os.homedir())) : '',
  clientDist: path.join(ROOT, 'client', 'dist'),
  masterKey: masterKey(),
  sessionDays: Number(env.ERP_SESSION_DAYS || 14),
  // نافذة صلاحية كلمة مرور العمليات الحساسة بعد إدخالها (بالدقائق) — 0 = في كل مرة
  sensitiveWindowMin: Number(env.ERP_SENSITIVE_WINDOW_MIN || 0),
  // من نثق بترويسة X-Forwarded-For منه (لمعرفة IP الزائر الحقيقي في حدّ المحاولات):
  // 1 = وسيط على نفس الجهاز (tailscale serve)؛ أو قائمة Express مثل «loopback, uniquelocal» (Traefik داخل Docker)
  trustProxy: ['1', 'true'].includes(env.ERP_TRUST_PROXY) ? 'loopback' : ['', '0', 'false'].includes(env.ERP_TRUST_PROXY || '') ? false : env.ERP_TRUST_PROXY,
  disableScheduler: env.ERP_DISABLE_SCHEDULER === '1',
  // عناوين عامة إضافية مسموحة (مثل رابط Tailscale Funnel أو Cloudflare) عند وجود وسيط يغيّر ترويسة Host
  allowedOrigins: String(env.ERP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim().replace(/\/$/, ''))
    .filter(Boolean),
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  // مجلد التبادل مع خدمة التحديث على الـ VPS (غير موجود على الحاسوب)
  updaterDir: env.ERP_UPDATER_MOUNT || '/updater',
  isTest: env.NODE_ENV === 'test' || Boolean(env.NODE_TEST_CONTEXT),
};
