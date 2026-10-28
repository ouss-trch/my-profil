import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { getSetting } from '../lib/settings.js';
import { IntegrationError, request } from '../lib/http.js';
import { dzDay } from '../lib/util.js';
import { runJob } from './sync.js';

/**
 * النسخ الاحتياطي: نسخة يومية في data/backups (آخر 14)، ونسخة ثانية خارج الجهاز:
 *  - على حاسوب: مجلد متزامن مع السحابة (ERP_BACKUP_MIRROR: Google Drive / OneDrive / iCloud، آخر 30)
 *  - على الـ VPS: الملف مضغوطاً إلى Webhook في n8n يرفعه إلى Google Drive (n8n_backup_url، آخر 30 هناك)
 * إن تعطّل الجهاز: الكود في GitHub + آخر نسخة من السحابة = الـ ERP كما كان (انظر README).
 */
const KEEP_LOCAL = 14;
const KEEP_MIRROR = 30;
const isBackup = (f) => /^toureche-\d{4}-\d{2}-\d{2}\.db$/.test(f);

function list(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(isBackup)
    .sort()
    .map((f) => ({ name: f, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
}

function prune(dir, keep) {
  const files = list(dir);
  for (const old of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, old.name));
}

function mirror(file) {
  const dir = config.backupMirrorDir;
  if (!dir) return null;
  // لا ننشئ مسار السحابة كاملاً: إن لم يكن مجلدها الأب موجوداً (Drive غير مثبت أو غير مركّب) نُبلغ بدل نسخة محلية توهم بالأمان
  if (!fs.existsSync(dir)) {
    if (!fs.existsSync(path.dirname(dir))) throw Object.assign(new Error('mirror_unreachable'), { code: 'mirror_unreachable' });
    fs.mkdirSync(dir);
  }
  const dest = path.join(dir, path.basename(file));
  // نسخ ثم إعادة تسمية: لا تتزامن السحابة أبداً نسخة نصف مكتوبة
  fs.copyFileSync(file, `${dest}.part`);
  fs.renameSync(`${dest}.part`, dest);
  prune(dir, KEEP_MIRROR);
  return dest;
}

const gzip = promisify(zlib.gzip);
const DRIVE_JOB = 'backup_drive';
// نسخة واحدة في الليلة: نجاح أقدم من هذا = النسخة خارج الخادم متأخرة
const DRIVE_FRESH_MS = 36 * 3600e3;

async function toDrive(file) {
  const url = getSetting('n8n_backup_url');
  if (!url) return null;
  const name = `${path.basename(file)}.gz`;
  const body = await gzip(fs.readFileSync(file));
  return runJob(DRIVE_JOB, 0, 'نسخة Google Drive', async () => {
    const { data } = await request('n8n', `${url}${url.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body,
      timeoutMs: 120000,
      retries: 1,
    });
    // لا نعدّ النسخة محفوظة إلا إن أكّد n8n أن Google Drive استلمها
    if (!data?.ok) throw new IntegrationError('n8n', 'invalid', 'drive_upload_unconfirmed');
    return { name, bytes: body.length };
  });
}

/** نسخة اليوم (force = إعادة كتابتها بالحالة الحالية) ثم نسخها خارج الجهاز (مجلد سحابي و/أو Google Drive عبر n8n) */
export async function backup({ force = false } = {}) {
  const file = path.join(config.backupsDir, `toureche-${dzDay()}.db`);
  if (force || !fs.existsSync(file)) {
    const tmp = `${file}.part`;
    await db.backup(tmp);
    fs.renameSync(tmp, file);
    prune(config.backupsDir, KEEP_LOCAL);
  }
  let mirrored = null;
  let mirrorError = null;
  try {
    mirrored = mirror(file);
  } catch (e) {
    mirrorError = e.code || e.message;
  }
  let drive = null;
  let driveError = null;
  try {
    drive = await toDrive(file);
  } catch (e) {
    driveError = e.message;
  }
  return { file, mirrored, mirrorError, drive, driveError };
}

export function backupStatus() {
  const local = list(config.backupsDir);
  const remote = list(config.backupMirrorDir);
  const lastLocal = local.at(-1) || null;
  const lastMirror = remote.at(-1) || null;
  const job = db.prepare('SELECT last_run_at, last_ok_at, last_error FROM job_state WHERE job = ? AND project_id = 0').get(DRIVE_JOB);
  const driveOn = Boolean(getSetting('n8n_backup_url'));
  const mirrorOk = Boolean(config.backupMirrorDir) && fs.existsSync(config.backupMirrorDir) && Boolean(lastMirror) && !(lastLocal && lastMirror.name < lastLocal.name);
  const driveOk = driveOn && Boolean(job?.last_ok_at) && !job?.last_error && Date.now() - Date.parse(job.last_ok_at) < DRIVE_FRESH_MS;
  return {
    offsite_ok: mirrorOk || driveOk,
    drive: { configured: driveOn, ok: driveOk, last_ok_at: job?.last_ok_at || null, last_run_at: job?.last_run_at || null, error: job?.last_error || null },
    local: { dir: config.backupsDir, count: local.length, last: lastLocal },
    mirror: {
      configured: Boolean(config.backupMirrorDir),
      dir: config.backupMirrorDir || null,
      reachable: Boolean(config.backupMirrorDir) && fs.existsSync(config.backupMirrorDir),
      count: remote.length,
      last: lastMirror,
      behind: Boolean(lastLocal && (!lastMirror || lastMirror.name < lastLocal.name)),
    },
  };
}
