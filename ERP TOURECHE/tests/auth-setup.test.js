import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { db } from '../server/db/index.js';

// خلف Traefik داخل Docker: الوسيط على عنوان خاص، والرمز في مجلد بيانات مؤقت
config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-setup-'));
config.trustProxy = 'loopback, uniquelocal';
const { createApp } = await import('../server/app.js');
const { setupToken } = await import('../server/lib/auth.js');

const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}/api/auth`;
const viaProxy = { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' };
const call = (p, { headers = {}, body } = {}) =>
  fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const admin = { username: 'owner', password: 'pass1234', sensitive_password: 'sens1234' };
const tokenFile = path.join(config.dataDir, '.setup-token');

test('setup: same-computer visit needs no token, a visit through the proxy does', async () => {
  assert.equal((await call('/status')).json.setup_token_required, false);
  const s = await call('/status', { headers: viaProxy });
  assert.equal(s.json.setup_required, true);
  assert.equal(s.json.setup_token_required, true);
});

test('setup: a stranger reaching the public URL first cannot become admin', async () => {
  assert.equal((await call('/setup', { headers: viaProxy, body: admin })).json.error, 'setup_token_required');
  assert.equal((await call('/setup', { headers: viaProxy, body: { ...admin, setup_token: 'AAAA-BBBB-CCCC-DDDD-EEEE' } })).json.error, 'setup_token_wrong');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('setup: the owner types the token (any case, with or without dashes), then it is gone', async () => {
  const token = setupToken();
  assert.match(token, /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
  assert.equal((fs.statSync(tokenFile).mode & 0o777).toString(8), '600');
  const r = await call('/setup', { headers: viaProxy, body: { ...admin, setup_token: token.toLowerCase().replaceAll('-', '') } });
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(tokenFile), false);
  assert.equal(setupToken(), null);
  assert.equal((await call('/setup', { headers: viaProxy, body: { ...admin, setup_token: token } })).status, 409);
});

test('trust proxy: lockouts count the visitor IP behind Traefik, and a forged X-Forwarded-For does not change it', async () => {
  const trusted = app.get('trust proxy fn');
  assert.ok(trusted('172.18.0.5', 0), 'Traefik on the Docker network is trusted');
  assert.ok(!trusted('203.0.113.7', 1), 'a public address is never trusted');
  await call('/login', { headers: viaProxy, body: { username: 'owner', password: 'pass1234' } });
  await call('/login', { headers: { ...viaProxy, 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, body: { username: 'owner', password: 'pass1234' } });
  const ips = db.prepare('SELECT ip FROM sessions ORDER BY rowid').all().map((r) => r.ip);
  assert.deepEqual([...new Set(ips)], ['203.0.113.7']);
});
