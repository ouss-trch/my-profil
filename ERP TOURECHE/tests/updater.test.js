import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../server/config.js';
import { updateStatus, requestUpdate, requestCheck } from '../server/services/updater.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (f, s) => fs.writeFileSync(f, s);

test('updater (ERP side): reads the host state, writes requests, refuses double runs', () => {
  config.updaterDir = path.join(tmp('upd-missing-'), 'nope');
  assert.equal(updateStatus().supported, false);
  assert.ok(updateStatus().current); // النسخة تظهر حتى على الحاسوب
  assert.throws(() => requestUpdate(), /updater_unsupported/);

  const dir = tmp('upd-');
  config.updaterDir = dir;
  fs.mkdirSync(path.join(dir, 'inbox'));
  fs.mkdirSync(path.join(dir, 'state'));
  assert.throws(() => requestUpdate(), /updater_not_installed/);

  const now = new Date().toISOString();
  write(path.join(dir, 'state', 'agent'), `version=1\nseen_at=${now}\n`);
  write(path.join(dir, 'state', 'check'), `checked_at=${now}\nbranch=origin/main\nbehind=2\nerror=\nc=abc1234\x1f${now}\x1fFix returns\nc=def5678\x1f${now}\x1fAdd update button\n`);
  const s = updateStatus();
  assert.equal(s.agent.alive, true);
  assert.equal(s.check.behind, 2);
  assert.deepEqual(s.check.changes.map((c) => c.subject), ['Fix returns', 'Add update button']);
  assert.equal(s.check.error, null);

  const out = requestUpdate();
  assert.ok(fs.existsSync(path.join(dir, 'inbox', 'update')));
  assert.equal(out.pending.stuck, false);
  assert.throws(() => requestUpdate(), /update_running/);
  requestCheck(); // لا يضيف طلب فحص أثناء التحديث
  assert.equal(fs.existsSync(path.join(dir, 'inbox', 'check')), false);

  fs.rmSync(path.join(dir, 'inbox', 'update'));
  write(path.join(dir, 'state', 'update'), `state=running\nstep=build\nstarted_at=${now}\n`);
  assert.throws(() => requestUpdate(), /update_running/);
  // تحديث «جارٍ» منذ ساعة = توقف (الخادم أُعيد تشغيله مثلاً): يُسمح بإعادة المحاولة
  write(path.join(dir, 'state', 'update'), `state=running\nstep=build\nstarted_at=${new Date(Date.now() - 3600e3).toISOString()}\n`);
  assert.equal(updateStatus().update.state, 'stale');
  requestUpdate();
});

// ——— الجهة الأخرى: deploy/erp.sh على الخادم، مع Docker و systemctl وهميين ومستودع GitHub محلي ———
const hasTools = process.platform !== 'win32' && ['bash', 'git', 'flock'].every((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0);

function fakeVps() {
  const root = tmp('vps-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // docker وهمي: يسجّل الأوامر، والصحة من ملف (healthy/unhealthy)، و FAIL_BUILD لإفشال البناء
  write(
    path.join(bin, 'docker'),
    `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE/calls"
case "$*" in
  *"inspect -f {{.State.Running}}"*) echo true ;;
  *"inspect -f {{range .Config.Env}}"*) cat "$FAKE/running_env" 2>/dev/null ;;
  *"inspect -f {{if .State.Health}}"*) if grep -q rolled "$FAKE/marks" 2>/dev/null; then echo healthy; else cat "$FAKE/health"; fi ;;
  *"image inspect"*) exit 0 ;;
  *"tag erp-toureche:previous erp-toureche:latest"*) echo rolled >> "$FAKE/marks" ;;
  *" build erp"*) [ -f "$FAKE/fail_build" ] && { echo "build error"; exit 1; }; env | grep '^ERP_COMMIT=' > "$FAKE/build_env" ;;
  exec*) echo "✓ /data/backups/x.db" ;;
esac
exit 0
`,
  );
  write(path.join(bin, 'systemctl'), `#!/usr/bin/env bash\necho "systemctl $*" >> "$FAKE/calls"\n`);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  fs.chmodSync(path.join(bin, 'systemctl'), 0o755);

  // GitHub = مستودع bare؛ الخادم = نسخة منه فيها ERP TOURECHE/deploy/erp.sh الحقيقي
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  const seed = path.join(root, 'seed');
  fs.mkdirSync(path.join(seed, 'ERP TOURECHE', 'deploy'), { recursive: true });
  fs.copyFileSync(path.join(HERE, '..', 'deploy', 'erp.sh'), path.join(seed, 'ERP TOURECHE', 'deploy', 'erp.sh'));
  write(path.join(seed, 'ERP TOURECHE', 'app.txt'), 'v1\n');
  git(root, 'init', '-q', '-b', 'main', 'seed');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'v1');
  git(root, 'clone', '-q', '--bare', 'seed', 'origin.git');
  git(root, 'clone', '-q', 'origin.git', 'vps');
  const vps = path.join(root, 'vps');
  write(path.join(vps, 'ERP TOURECHE', 'deploy', '.env'), 'ERP_DOMAIN=erp.example\n');
  const v1 = git(vps, 'rev-parse', 'HEAD');
  write(path.join(root, 'running_env'), `PATH=/usr/bin\nERP_COMMIT=${v1}\n`);

  const push = (msg, file = 'ERP TOURECHE/app.txt') => {
    git(seed, 'pull', '-q', path.join(root, 'origin.git'), 'main');
    write(path.join(seed, file), msg + '\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', msg);
    git(seed, 'push', '-q', path.join(root, 'origin.git'), 'main');
    return git(seed, 'rev-parse', 'HEAD');
  };
  const upd = path.join(root, 'updater');
  const units = path.join(root, 'units');
  fs.mkdirSync(units);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE: root, ERP_UPDATER_DIR: upd, ERP_LOCK_FILE: path.join(root, 'lock'), ERP_SYSTEMD_DIR: units, ERP_HEALTH_TIMEOUT: '3' };
  const erp = (...a) => spawnSync('bash', [path.join(vps, 'ERP TOURECHE', 'deploy', 'erp.sh'), ...a], { env, encoding: 'utf8' });
  const state = (name) => Object.fromEntries(fs.readFileSync(path.join(upd, 'state', name), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const calls = () => (fs.existsSync(path.join(root, 'calls')) ? fs.readFileSync(path.join(root, 'calls'), 'utf8') : '');
  const reset = () => ['calls', 'marks', 'fail_build'].forEach((f) => fs.rmSync(path.join(root, f), { force: true }));
  return { root, vps, upd, units, git, push, erp, state, calls, reset, v1 };
}

test('updater (host side): check → update from the button → version baked in; rollback; build failure', { skip: !hasTools && 'bash/git/flock missing' }, () => {
  const v = fakeVps();
  write(path.join(v.root, 'health'), 'healthy');

  // فحص: تغييران داخل ERP TOURECHE، وتغيير خارجه لا يُحسب
  v.push('Fix returns');
  v.push('Docs only', 'README-root.md');
  const head = v.push('Add update button');
  let r = v.erp('agent');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  let c = v.state('check');
  assert.equal(c.behind, '2');
  assert.equal(c.error, '');
  assert.ok(v.state('agent').seen_at);

  // طلب من الزر: نسخة احتياطية ← pull ← build (مع رقم النسخة) ← up ← صحة جيدة
  fs.writeFileSync(path.join(v.upd, 'inbox', 'update'), 'x');
  r = v.erp('agent');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(fs.existsSync(path.join(v.upd, 'inbox', 'update')), false);
  let u = v.state('update');
  assert.equal(u.state, 'ok', fs.readFileSync(path.join(v.upd, 'state', 'log'), 'utf8'));
  assert.equal(u.by, 'ui');
  assert.equal(u.from, v.v1);
  assert.equal(u.to, head);
  assert.equal(v.git(v.vps, 'rev-parse', 'HEAD'), head);
  const order = ['exec erp-toureche', 'tag erp-toureche:latest erp-toureche:previous', ' build erp', ' up -d'].map((k) => v.calls().indexOf(k));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), v.calls());
  assert.match(fs.readFileSync(path.join(v.root, 'build_env'), 'utf8'), new RegExp(`ERP_COMMIT=${head}`));
  // خدمة systemd كُتبت وفُعّلت
  assert.match(fs.readFileSync(path.join(v.units, 'erp-updater.path'), 'utf8'), /PathExists=.*inbox\/update/);
  assert.match(fs.readFileSync(path.join(v.units, 'erp-updater.service'), 'utf8'), /ExecStart=\/bin\/bash ".*erp\.sh" agent/);
  assert.match(v.calls(), /systemctl enable --now erp-updater.path erp-updater.timer/);

  // نسخة جديدة لا تشتغل ← رجوع تلقائي للصورة السابقة
  v.reset();
  write(path.join(v.root, 'running_env'), `ERP_COMMIT=${head}\n`);
  v.push('Broken release');
  write(path.join(v.root, 'health'), 'unhealthy');
  r = v.erp('update');
  assert.equal(r.status, 1);
  u = v.state('update');
  assert.equal(u.state, 'failed');
  assert.equal(u.error, 'rolled_back');
  assert.equal(u.step, 'verify');
  assert.match(v.calls(), /tag erp-toureche:previous erp-toureche:latest/);

  // فشل البناء ← الحاوية القديمة لم تُلمس
  v.reset();
  write(path.join(v.root, 'health'), 'healthy');
  write(path.join(v.root, 'fail_build'), '1');
  v.push('Does not build');
  r = v.erp('update');
  assert.equal(r.status, 1);
  u = v.state('update');
  assert.deepEqual([u.state, u.step, u.error], ['failed', 'build', 'build_failed']);
  assert.doesNotMatch(v.calls(), / up -d/);
});
