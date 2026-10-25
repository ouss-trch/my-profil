import { Router } from 'express';
import { db } from '../db/index.js';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/crypto.js';
import { createSession, destroySession, requireAuth, requireRole, requireSensitive, checkLocked, recordFail, clearFails, usersCount } from '../lib/auth.js';
import { getSensitiveHash, setSensitiveHash } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, v } from '../lib/util.js';
import { createProject } from '../services/projects.js';

export const authRouter = Router();

// تجزئة وهمية لمساواة زمن الرد بين «مستخدم غير موجود» و«كلمة مرور خاطئة»
let dummyHash = null;
const getDummyHash = async () => (dummyHash ||= await hashPassword('timing-equalizer-only'));

authRouter.get('/status', (req, res) => {
  res.json({ setup_required: usersCount() === 0, user: req.user || null, sensitive_password_set: Boolean(getSensitiveHash()) });
});

/** أول تشغيل: إنشاء حساب المدير + كلمة مرور العمليات الحساسة + أول مشروع */
authRouter.post('/setup', async (req, res) => {
  if (usersCount() > 0) throw new HttpError(409, 'already_setup');
  const username = v.str(req.body.username, { required: true, max: 40, name: 'username' });
  const password = String(req.body.password || '');
  const sensitive = String(req.body.sensitive_password || '');
  const problem = passwordProblem(password) || passwordProblem(sensitive);
  if (problem) throw badRequest(problem);
  if (password === sensitive) throw badRequest('sensitive_must_differ');
  const info = db.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'admin')").run(username, v.str(req.body.display_name, { max: 80 }) || username, await hashPassword(password));
  setSensitiveHash(await hashPassword(sensitive));
  if (!db.prepare('SELECT 1 FROM projects').get()) createProject({ name: v.str(req.body.project_name, { max: 80 }) || 'SOU9NA', domain: v.str(req.body.project_domain, { max: 120 }) });
  createSession(req, res, info.lastInsertRowid);
  audit({ ...req, user: { id: info.lastInsertRowid } }, 'setup');
  res.json({ ok: true });
});

authRouter.post('/login', async (req, res) => {
  const username = v.str(req.body.username, { required: true, max: 40, name: 'username' });
  checkLocked('login', req, username);
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  const ok = await verifyPassword(req.body.password, user?.password_hash || (await getDummyHash()));
  if (!user || !ok) {
    recordFail('login', req, username);
    throw new HttpError(401, 'invalid_credentials');
  }
  clearFails('login', req, username);
  createSession(req, res, user.id);
  audit({ ...req, user }, 'login');
  res.json({ ok: true, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

/** التحقق من كلمة مرور العمليات الحساسة دون تنفيذ شيء (لفتح الأقسام الحساسة في الواجهة) */
authRouter.post('/verify-sensitive', requireAuth, requireSensitive, (_req, res) => res.json({ ok: true }));

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(req.body.current_password, user.password_hash))) throw new HttpError(403, 'current_password_wrong');
  const problem = passwordProblem(req.body.new_password);
  if (problem) throw badRequest(problem);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.new_password), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.session.id);
  audit(req, 'password_changed');
  res.json({ ok: true });
});

authRouter.post('/sensitive-password', requireRole('admin'), requireSensitive, async (req, res) => {
  const problem = passwordProblem(req.body.new_password);
  if (problem) throw badRequest(problem);
  setSensitiveHash(await hashPassword(req.body.new_password));
  audit(req, 'sensitive_password_changed');
  res.json({ ok: true });
});

// ——— المستخدمون (المدير فقط) ———
export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

usersRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT id, username, display_name, role, active, created_at, last_login_at FROM users ORDER BY id').all());
});

usersRouter.post('/', requireSensitive, async (req, res) => {
  const username = v.str(req.body.username, { required: true, max: 40, name: 'username' });
  const problem = passwordProblem(req.body.password);
  if (problem) throw badRequest(problem);
  const role = v.oneOf(req.body.role || 'agent', ['admin', 'manager', 'agent'], { name: 'role' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'username_taken');
  const info = db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, v.str(req.body.display_name, { max: 80 }) || username, await hashPassword(req.body.password), role);
  audit(req, 'user_created', { entity: 'user', entityId: info.lastInsertRowid, details: { username, role } });
  res.json({ id: Number(info.lastInsertRowid) });
});

usersRouter.patch('/:id', requireSensitive, async (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'user_not_found');
  const role = req.body.role ? v.oneOf(req.body.role, ['admin', 'manager', 'agent'], { name: 'role' }) : u.role;
  const active = req.body.active === undefined ? u.active : req.body.active ? 1 : 0;
  if (id === req.user.id && (role !== 'admin' || !active)) throw badRequest('cannot_demote_self');
  db.prepare('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?').run(v.str(req.body.display_name, { max: 80 }) ?? u.display_name, role, active, id);
  if (req.body.password) {
    const problem = passwordProblem(req.body.password);
    if (problem) throw badRequest(problem);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(req, 'user_updated', { entity: 'user', entityId: id, details: { role, active, password_reset: Boolean(req.body.password) } });
  res.json({ ok: true });
});
