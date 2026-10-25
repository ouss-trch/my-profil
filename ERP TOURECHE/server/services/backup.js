import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { dzDay } from '../lib/util.js';

/**
 * النسخ الاحتياطي: نسخة يومية في data/backups (آخر 14)، ونسخة ثانية خارج الجهاز
 * في مجلد متزامن مع السحابة (ERP_BACKUP_MIRROR: Google Drive / OneDrive / iCloud، آخر 30).
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

/** نسخة اليوم (force = إعادة كتابتها بالحالة الحالية) ثم نسخها إلى المجلد السحابي */
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
  return { file, mirrored, mirrorError };
}

export function backupStatus() {
  const local = list(config.backupsDir);
  const remote = list(config.backupMirrorDir);
  const lastLocal = local.at(-1) || null;
  const lastMirror = remote.at(-1) || null;
  return {
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
