// أدوات سطر الأوامر:
//   npm run reset-password -- <username> <new-password>
//   npm run reset-password -- --sensitive <new-password>
//   npm run restore -- <ملف-النسخة-الاحتياطية.db>   (أوقف الـ ERP قبلها)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from './config.js';

const [, , cmd, a, b] = process.argv;

async function resetPassword() {
  const { db } = await import('./db/index.js');
  const { hashPassword, passwordProblem } = await import('./lib/crypto.js');
  const { setSensitiveHash } = await import('./lib/settings.js');
  if (a === '--sensitive') {
    const problem = passwordProblem(b);
    if (problem) throw new Error(problem);
    setSensitiveHash(await hashPassword(b));
    console.log('✓ تم تغيير كلمة مرور العمليات الحساسة');
    return;
  }
  const problem = passwordProblem(b);
  if (problem) throw new Error(problem);
  const info = db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE username = ?').run(await hashPassword(b), a);
  if (!info.changes) throw new Error(`user_not_found: ${a}`);
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(a);
  console.log(`✓ تم تغيير كلمة مرور ${a}`);
}

/** استرجاع قاعدة البيانات من نسخة احتياطية (جهاز جديد أو بعد عطل): يتحقق من نسخة عاملة بجانب القاعدة، يحفظ القاعدة الحالية، ثم يستبدلها دفعة واحدة */
export function restore(source, target = config.dbFile) {
  if (!source || !fs.existsSync(source)) throw new Error(`backup_not_found: ${source || ''}`);
  // نعمل على نسخة في مجلد البيانات: الملف الأصلي لا يُلمس (قد يكون للقراءة فقط) وملفات WAL المؤقتة تُنشأ بجانبها
  const work = path.join(path.dirname(target), `.restore-${Date.now()}.db`);
  const clean = (f) => ['', '-wal', '-shm'].forEach((ext) => fs.rmSync(`${f}${ext}`, { force: true }));
  // نسخة Google Drive مضغوطة (.db.gz): تُعرف من أول بايتين، لأن erp.sh يمرّرها باسم آخر (/import.db)
  const head = Buffer.alloc(2);
  const fd = fs.openSync(source, 'r');
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  if (head[0] === 0x1f && head[1] === 0x8b) fs.writeFileSync(work, zlib.gunzipSync(fs.readFileSync(source)));
  else fs.copyFileSync(source, work);
  let orders;
  try {
    const check = new Database(work, { fileMustExist: true });
    try {
      if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('backup_corrupt');
      if (!check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get()) throw new Error('not_an_erp_backup');
      orders = check.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
      check.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      check.close();
    }
  } catch (e) {
    clean(work);
    throw e;
  }
  let saved = null;
  if (fs.existsSync(target)) {
    // كتابة ما في ملف WAL داخل القاعدة قبل حفظها حتى تكون النسخة المحفوظة كاملة؛ قاعدة تالفة (سبب الاسترجاع غالباً) تُحفظ كما هي
    try {
      const cur = new Database(target, { fileMustExist: true });
      cur.pragma('wal_checkpoint(TRUNCATE)');
      cur.close();
    } catch {
      /* تُنسخ كما هي */
    }
    saved = path.join(config.backupsDir, `before-restore-${Date.now()}.db`);
    fs.copyFileSync(target, saved);
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${target}${ext}`, { force: true });
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${work}${ext}`, { force: true });
  fs.renameSync(work, target);
  return { orders, saved };
}

async function main() {
  if (cmd === 'reset-password') return resetPassword();
  if (cmd === 'restore') {
    const out = restore(a && path.resolve(a));
    console.log(`✓ تم الاسترجاع: ${out.orders} طلبية`);
    if (out.saved) console.log(`  القاعدة السابقة محفوظة في ${out.saved}`);
    console.log('  إن لم يكن ملف data/.secret-key القديم موجوداً: أعد إدخال مفاتيح الربط من الإعدادات (الطلبيات والزبائن لا تتأثر).');
    return;
  }
  throw new Error('usage: node server/cli.js reset-password <username|--sensitive> <new-password> | restore <backup.db>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
}
