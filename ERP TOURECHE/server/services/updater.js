import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, ROOT } from '../config.js';
import { HttpError, nowIso } from '../lib/util.js';

/**
 * زر «تحديث الآن» (الإعدادات ← النظام). الحاوية لا تستطيع تحديث نفسها، فتكتب طلباً في /updater/inbox،
 * وخدمة erp-updater على الخادم (deploy/erp.sh agent عبر systemd) تأخذ نسخة احتياطية، تجلب الكود، تعيد البناء،
 * وتفحص التشغيل (مع رجوع تلقائي للنسخة السابقة)، ثم تكتب النتيجة في /updater/state (قراءة فقط هنا).
 * ملفات الحالة أسطر key=value؛ التغييرات أسطر c=commit␟date␟subject.
 */
const STALE_RUN_MS = 45 * 60e3;
const AGENT_SILENT_MS = 7 * 3600e3; // المؤقّت يفحص كل 6 ساعات
const PICKUP_MS = 90e3;

const file = (...p) => path.join(config.updaterDir, ...p);
const readState = (name) => {
  try {
    return fs.readFileSync(file('state', name), 'utf8');
  } catch {
    return '';
  }
};

export function parseState(text) {
  const out = { c: [] };
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1).trim();
    if (k === 'c') out.c.push(v);
    else out[k] = v;
  }
  return out;
}

let gitVersion;
/** النسخة التي تعمل الآن: مكتوبة في الصورة عند البناء (VPS)، أو من git مباشرة (حاسوب) */
export function currentVersion() {
  const e = process.env;
  if (e.ERP_COMMIT) return { commit: e.ERP_COMMIT, date: e.ERP_COMMIT_DATE || null, subject: e.ERP_COMMIT_SUBJECT || '', built_at: e.ERP_BUILT_AT || null };
  if (gitVersion === undefined) {
    try {
      const [commit, date, subject] = execFileSync('git', ['log', '-1', '--format=%H%x1f%cI%x1f%s'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
        .trim()
        .split('\x1f');
      gitVersion = commit ? { commit, date, subject, built_at: null } : null;
    } catch {
      gitVersion = null;
    }
  }
  return gitVersion || { commit: null, date: null, subject: '', built_at: null };
}

const ageMs = (iso) => (iso ? Date.now() - Date.parse(iso) : Infinity);

export function updateStatus() {
  const current = currentVersion();
  if (!fs.existsSync(file('inbox'))) return { supported: false, current };
  const agent = parseState(readState('agent'));
  const check = parseState(readState('check'));
  const upd = parseState(readState('update'));
  let pending = null;
  try {
    pending = { since: fs.statSync(file('inbox', 'update')).mtime.toISOString() };
  } catch {
    /* لا طلب معلّق */
  }
  let state = upd.state || null;
  if (state === 'running' && ageMs(upd.started_at) > STALE_RUN_MS) state = 'stale';
  return {
    supported: true,
    current,
    agent: { installed: Boolean(agent.seen_at), seen_at: agent.seen_at || null, alive: ageMs(agent.seen_at) < AGENT_SILENT_MS },
    check: check.checked_at
      ? {
          checked_at: check.checked_at,
          branch: check.branch || null,
          behind: Number(check.behind) || 0,
          error: check.error || null,
          changes: check.c.map((l) => {
            const [commit, date, subject] = l.split('\x1f');
            return { commit, date, subject };
          }),
        }
      : null,
    update: state ? { state, step: upd.step || null, error: upd.error || null, started_at: upd.started_at || null, finished_at: upd.finished_at || null, from: upd.from || null, to: upd.to || null, by: upd.by || null } : null,
    // طلب لم تأخذه الخدمة بعد دقيقة ونصف: الخدمة غير مثبتة أو متوقفة
    pending: pending ? { ...pending, stuck: ageMs(pending.since) > PICKUP_MS } : null,
    log: readState('log').split('\n').slice(-60).join('\n').trim(),
  };
}

function writeInbox(name) {
  // الكتابة ثم إعادة التسمية: الخدمة لا ترى ملفاً نصف مكتوب
  const tmp = file('inbox', `.${name}.${process.pid}`);
  fs.writeFileSync(tmp, nowIso() + '\n');
  fs.renameSync(tmp, file('inbox', name));
}

export function requestUpdate() {
  const s = updateStatus();
  if (!s.supported) throw new HttpError(400, 'updater_unsupported');
  if (!s.agent.installed) throw new HttpError(409, 'updater_not_installed');
  if (s.pending || s.update?.state === 'running') throw new HttpError(409, 'update_running');
  writeInbox('update');
  return updateStatus();
}

export function requestCheck() {
  const s = updateStatus();
  if (!s.supported) throw new HttpError(400, 'updater_unsupported');
  if (!s.pending && s.update?.state !== 'running') writeInbox('check');
  return updateStatus();
}
