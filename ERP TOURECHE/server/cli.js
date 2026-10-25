// أدوات سطر الأوامر:
//   npm run reset-password -- <username> <new-password>
//   npm run reset-password -- --sensitive <new-password>
//   npm run restore -- <ملف-النسخة-الاحتياطية.db>   (أوقف الـ ERP قبلها)
import fs from 'node:fs';
import path from 'node:path';
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

/** استرجاع قاعدة البيانات من نسخة احتياطية (جهاز جديد أو بعد عطل): يتحقق من النسخة ويحفظ القاعدة الحالية أولاً */
export function restore(source, target = config.dbFile) {
  if (!source || !fs.existsSync(source)) throw new Error(`backup_not_found: ${source || ''}`);
  const check = new Database(source, { readonly: true, fileMustExist: true });
  let orders;
  try {
    if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('backup_corrupt');
    if (!check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get()) throw new Error('not_an_erp_backup');
    orders = check.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  } finally {
    check.close();
  }
  let saved = null;
  if (fs.existsSync(target)) {
    saved = path.join(config.backupsDir, `before-restore-${Date.now()}.db`);
    fs.copyFileSync(target, saved);
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${target}${ext}`, { force: true });
  fs.copyFileSync(source, `${target}.part`);
  fs.renameSync(`${target}.part`, target);
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
