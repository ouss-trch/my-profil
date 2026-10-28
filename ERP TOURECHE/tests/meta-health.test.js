import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { getSetting, setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { decisions } from '../server/services/ads.js';
import { metaAlerts, refreshTokenState, saveTokenState, daysLeft } from '../server/services/metaHealth.js';

const p = createProject({ name: 'Health shop', domain: 'health.example' });
for (const [k, v] of [
  ['meta_access_token', 'EAAhealth'],
  ['meta_ad_account_ids', ['1021341893008834']],
])
  setSetting(k, v, p.id);

const DAY = 864e5;
const sec = (days) => Math.floor((Date.now() + days * DAY) / 1000);
const kinds = () => metaAlerts(p.id).map((a) => a.kind);
const state = (patch) => setSetting('meta_token_state', { checked_at: new Date().toISOString(), valid: true, type: 'USER', expires_at: null, data_access_expires_at: null, ends_at: null, ...patch }, p.id);

let reply = null;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  assert.ok(u.pathname.endsWith('/debug_token'), `unexpected ${url}`);
  if (reply === 'network') throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
  return new Response(JSON.stringify(reply), { status: reply.error ? 400 : 200, headers: { 'content-type': 'application/json' } });
};

test('token alerts: silent when fine or never expiring, then medium, high, critical as the date nears, and after it passes', () => {
  assert.deepEqual(kinds(), [], 'no stored state: nothing invented');
  state({ type: 'SYSTEM_USER', expires_at: 0 });
  assert.deepEqual(kinds(), [], 'a permanent token raises nothing');
  state({ expires_at: sec(40), ends_at: sec(40) });
  assert.deepEqual(kinds(), [], '40 days left: too early to nag');
  state({ expires_at: sec(12), ends_at: sec(12) });
  assert.deepEqual(metaAlerts(p.id).map((a) => [a.kind, a.severity, a.params.days]), [['token_expiring', 'medium', 12]]);
  state({ ends_at: sec(6) });
  assert.equal(metaAlerts(p.id)[0].severity, 'high');
  state({ ends_at: sec(2) });
  assert.equal(metaAlerts(p.id)[0].severity, 'critical');
  state({ ends_at: sec(-1) });
  assert.deepEqual(kinds(), ['token_expired']);
  state({ valid: false, ends_at: null });
  assert.deepEqual(kinds(), ['token_invalid'], 'a dead token is one alert, not two');
});

test('token alerts reach today’s decisions, and a project with no Meta token gets none', () => {
  state({ ends_at: sec(5) });
  const d = decisions(p.id).find((x) => x.kind === 'token_expiring');
  assert.ok(d, 'the advisor and the Today page read these decisions');
  assert.equal(d.severity, 'high');
  assert.equal(d.action, 'open_meta_settings');
  const empty = createProject({ name: 'No Meta', domain: 'nometa.example' });
  assert.deepEqual(metaAlerts(empty.id), []);
});

test('test-code alerts: active while it lasts, then “forgotten” once it has lapsed', () => {
  state({ ends_at: null });
  setSetting('meta_test_event_code', 'TEST1', p.id);
  assert.deepEqual(metaAlerts(p.id).map((a) => a.kind), ['test_code_active']);
  db.prepare("UPDATE settings SET updated_at = ? WHERE key = 'meta_test_event_code'").run(new Date(Date.now() - 5 * 3600e3).toISOString());
  assert.deepEqual(metaAlerts(p.id).map((a) => a.kind), ['test_code_left']);
  setSetting('meta_test_event_code', '', p.id);
  assert.deepEqual(kinds(), []);
});

test('daily check: stores the real dates; a dead token (190) is stored as invalid; a network failure changes nothing', async () => {
  reply = { data: { is_valid: true, type: 'USER', expires_at: sec(60), data_access_expires_at: sec(90) } };
  const ok = await refreshTokenState(p.id);
  assert.deepEqual([ok.valid, ok.type, daysLeft(ok)], [true, 'USER', 60]);
  reply = 'network';
  assert.equal((await refreshTokenState(p.id)).valid, true, 'an outage is not a verdict');
  reply = { error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190 } };
  const dead = await refreshTokenState(p.id);
  assert.deepEqual([dead.valid, dead.ends_at], [false, null]);
  // رمز جديد صالح يمحو الحكم السابق عند الفحص التالي
  reply = { data: { is_valid: true, type: 'SYSTEM_USER', expires_at: 0, data_access_expires_at: 0 } };
  const fresh = await refreshTokenState(p.id);
  assert.deepEqual([fresh.valid, fresh.ends_at, kinds()], [true, null, []]);
  // لا رمز: لا حالة
  setSetting('meta_access_token', '', p.id);
  assert.equal(await refreshTokenState(p.id), null);
  assert.equal(getSetting('meta_token_state', p.id), null);
});

test('a ready-made check result (the Settings “Test” button) is saved so the alert clears the moment the token is renewed', () => {
  setSetting('meta_access_token', 'EAAnew', p.id);
  state({ valid: false });
  assert.deepEqual(kinds(), ['token_invalid']);
  saveTokenState(p.id, { valid: true, type: 'SYSTEM_USER', expires_at: 0, data_access_expires_at: 0, ends_at: null });
  assert.deepEqual(kinds(), []);
});
