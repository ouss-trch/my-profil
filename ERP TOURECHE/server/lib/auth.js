import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { safeEqual, sha256, verifyPassword } from './crypto.js';
import { getSensitiveHash } from './settings.js';
import { HttpError, nowIso, randomId } from './util.js';

export const COOKIE = 'erp_session';
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

export function createSession(req, res, userId) {
  const token = randomId(32);
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionDays * 86400e3);
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
    req.ip,
    String(req.headers['user-agent'] || '').slice(0, 200),
  );
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps(req),
    expires,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

const sessionStmt = db.prepare(
  `SELECT s.id AS sid, s.expires_at, s.sensitive_until, u.id, u.username, u.display_name, u.role, u.active
   FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
);

export function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = sessionStmt.get(sha256(token));
    if (row && row.active && row.expires_at > nowIso()) {
      req.user = { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
      req.session = { id: row.sid, sensitive_until: row.sensitive_until };
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'unauthorized'));
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'unauthorized'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'forbidden'));
    next();
  };

// ——— الحماية من التخمين ———
const attemptKey = (kind, req, extra = '') => `${kind}:${req.ip}:${String(extra).toLowerCase()}`;

export function checkLocked(kind, req, extra) {
  const row = db.prepare('SELECT locked_until FROM login_attempts WHERE key = ?').get(attemptKey(kind, req, extra));
  if (row?.locked_until && row.locked_until > nowIso()) throw new HttpError(429, 'too_many_attempts', 'too_many_attempts', { until: row.locked_until });
}

export function recordFail(kind, req, extra) {
  const key = attemptKey(kind, req, extra);
  const row = db.prepare('SELECT count FROM login_attempts WHERE key = ?').get(key);
  const count = (row?.count || 0) + 1;
  const locked = count >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60e3).toISOString() : null;
  db.prepare(
    `INSERT INTO login_attempts (key, count, locked_until, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
  ).run(key, locked ? 0 : count, locked, nowIso());
}

export const clearFails = (kind, req, extra) => db.prepare('DELETE FROM login_attempts WHERE key = ?').run(attemptKey(kind, req, extra));

/**
 * العمليات الحساسة (حذف، تعديل الأسعار، الميزانيات، المفاتيح…) تتطلب كلمة مرور العمليات الحساسة
 * في الترويسة X-Confirm-Password. إن لم تُضبط كلمة منفصلة تُستعمل كلمة مرور دخول المستخدم.
 */
export function requireSensitive(req, _res, next) {
  (async () => {
    if (!req.user) throw new HttpError(401, 'unauthorized');
    if (config.sensitiveWindowMin > 0 && req.session?.sensitive_until && req.session.sensitive_until > nowIso()) return;
    checkLocked('sensitive', req, req.user.id);
    const given = req.headers['x-confirm-password'];
    if (!given) throw new HttpError(428, 'sensitive_password_required');
    const hash = getSensitiveHash() || db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id)?.password_hash;
    const ok = await verifyPassword(decodeURIComponent(String(given)), hash);
    if (!ok) {
      recordFail('sensitive', req, req.user.id);
      throw new HttpError(403, 'sensitive_password_wrong');
    }
    clearFails('sensitive', req, req.user.id);
    if (config.sensitiveWindowMin > 0)
      db.prepare('UPDATE sessions SET sensitive_until = ? WHERE id = ?').run(
        new Date(Date.now() + config.sensitiveWindowMin * 60e3).toISOString(),
        req.session.id,
      );
  })().then(() => next(), next);
}

export const usersCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// ——— رمز الإعداد الأول ———
// ما دام لا يوجد أي حساب، فأول من يفتح الرابط يصبح المدير. على خادم عام (VPS) يكفي أن يسبقك أحد إلى الرابط،
// لذلك يُطلب رمز يُكتب في data/.setup-token ولا يُرى إلا من داخل الخادم (نافذة التشغيل، أو deploy/erp.sh setup-token).
// من يفتح http://localhost مباشرة على نفس الجهاز معفى منه.
const setupTokenFile = () => path.join(config.dataDir, '.setup-token');
const normToken = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');

/** الرمز الحالي (يُنشأ عند الحاجة)، أو null إن كان الإعداد قد تمّ */
export function setupToken() {
  const file = setupTokenFile();
  if (usersCount() > 0) {
    fs.rmSync(file, { force: true });
    return null;
  }
  if (!fs.existsSync(file)) {
    const hex = crypto.randomBytes(10).toString('hex').toUpperCase();
    fs.writeFileSync(file, `${hex.match(/.{4}/g).join('-')}\n`, { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}

/** طلب مباشر من نفس الجهاز، لا عبر وسيط (Traefik / Tailscale serve يضيفان X-Forwarded-For) */
export function isDirectLocal(req) {
  const a = req.socket?.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(a) && !req.headers['x-forwarded-for'] && !req.headers.forwarded;
}

export const setupTokenRequired = (req) => usersCount() === 0 && !isDirectLocal(req);

export function checkSetupToken(req, given) {
  if (!setupTokenRequired(req)) return;
  if (!given) throw new HttpError(403, 'setup_token_required');
  if (!safeEqual(normToken(given), normToken(setupToken()))) throw new HttpError(403, 'setup_token_wrong');
}

export const clearSetupToken = () => fs.rmSync(setupTokenFile(), { force: true });
