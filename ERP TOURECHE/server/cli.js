// أدوات سطر الأوامر: إعادة تعيين كلمة مرور مستخدم أو كلمة مرور العمليات الحساسة
//   npm run reset-password -- <username> <new-password>
//   npm run reset-password -- --sensitive <new-password>
import { db } from './db/index.js';
import { hashPassword, passwordProblem } from './lib/crypto.js';
import { setSensitiveHash } from './lib/settings.js';

const [, , cmd, a, b] = process.argv;

async function main() {
  if (cmd !== 'reset-password') throw new Error('usage: node server/cli.js reset-password <username|--sensitive> <new-password>');
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

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
