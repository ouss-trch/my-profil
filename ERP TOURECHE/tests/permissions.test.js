import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { db } from '../server/db/index.js';

config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-perm-'));
const { createApp } = await import('../server/app.js');
const { createOrder, upsertFromShopify, setCustomerFlag } = await import('../server/services/orders.js');

const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}/api`;

/** متصفح صغير: يحفظ كوكي الجلسة، ويرسل كلمة المرور الحساسة إن أُعطيت */
function browser() {
  let cookie = '';
  return async (method, p, { body, sensitive } = {}) => {
    const headers = { 'content-type': 'application/json', cookie };
    if (sensitive) headers['x-confirm-password'] = sensitive;
    const r = await fetch(base + p, { method, headers, body: body && JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) if (c.startsWith('erp_session=')) cookie = c.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}

const SENS = 'sens1234';
const admin = browser();
assert.equal((await admin('POST', '/auth/setup', { body: { username: 'owner', password: 'pass1234', sensitive_password: SENS } })).status, 200);
const projectId = db.prepare('SELECT id FROM projects').get().id;
const users = {};
for (const [username, role] of [['conf', 'agent'], ['boss2', 'manager'], ['watch', 'viewer']]) {
  assert.equal((await admin('POST', '/users', { body: { username, password: 'pass1234', role }, sensitive: SENS })).status, 200, role);
  users[role] = browser();
  assert.equal((await users[role]('POST', '/auth/login', { body: { username, password: 'pass1234' } })).status, 200);
}
let n = 0;
const order = (extra = {}, source = 'shopify') => createOrder(projectId, { ref: `P-${++n}`, phone: '0550000001', wilaya: 16, items: [{ title: 'T', qty: 1, price: 2000 }], ...extra }, { source }).id;

test('roles: the viewer sees everything and changes nothing', async () => {
  const id = order();
  const v = users.viewer;
  assert.equal((await v('GET', '/auth/status')).json.user.role, 'viewer');
  assert.equal((await v('GET', '/orders')).status, 200);
  assert.equal((await v('GET', '/customers')).status, 200);
  const r = await v('POST', `/orders/${id}/status`, { body: { status: 'confirmed' } });
  assert.deepEqual([r.status, r.json.error], [403, 'read_only']);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(id).status, 'new');
  // تغيير كلمة مروره وتسجيل الخروج يبقيان ممكنين
  assert.equal((await v('POST', '/auth/logout', { body: {} })).status, 200);
  const list = (await admin('GET', '/users')).json;
  assert.equal(list.find((u) => u.username === 'watch').role, 'viewer');
  assert.equal(list.find((u) => u.username === 'conf').role, 'agent');
});

test('roles: the confirmer works on orders only; bulk delete is for the admin alone', async () => {
  const id = order();
  const agent = users.agent;
  assert.equal((await agent('POST', `/orders/${id}/status`, { body: { status: 'no_answer' } })).status, 200);
  for (const [method, p] of [
    ['PATCH', '/products/1'],
    ['POST', '/products/1/seo/generate'],
    ['POST', '/products/1/images/generate'],
    ['POST', '/ads/drafts'],
    ['POST', '/pages'],
  ]) {
    const r = await agent(method, p, { body: {} });
    assert.deepEqual([r.status, r.json.error], [403, 'forbidden'], `${method} ${p}`);
  }
  for (const who of [agent, users.manager]) {
    const r = await who('POST', '/orders/bulk/delete', { body: { ids: [id] }, sensitive: SENS });
    assert.deepEqual([r.status, r.json.error], [403, 'forbidden']);
  }
  assert.ok(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id));
});

test('bulk delete: the sensitive password every time, and Shopify, the Sheet or n8n never bring the orders back', async () => {
  const a = order({ ref: '1001', external_id: 'gid://shopify/Order/9001', shopify_name: '#1001' });
  const b = order({ ref: 'SH-77' }, 'sheet');
  const keep = order();
  assert.equal((await admin('POST', '/orders/bulk/delete', { body: { ids: [a, b] } })).status, 428);
  assert.equal((await admin('POST', '/orders/bulk/delete', { body: { ids: [a, b] }, sensitive: 'wrong-pass1' })).json.error, 'sensitive_password_wrong');
  const r = await admin('POST', '/orders/bulk/delete', { body: { ids: [a, b] }, sensitive: SENS });
  assert.deepEqual([r.status, r.json], [200, { deleted: 2 }]);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE id IN (${a}, ${b})`).get().n, 0);
  assert.ok(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(keep));
  // مزامنة Shopify (بالمعرّف أو بالرقم)، والجدول، و n8n
  const again = upsertFromShopify(projectId, { external_id: 'gid://shopify/Order/9001', shopify_name: '#1001', ref: null, phone: '0550000001', items: [], tags: [] });
  assert.equal(again.created, false);
  assert.equal(createOrder(projectId, { ref: 'SH-77', phone: '0550000001' }, { source: 'sheet' }).created, false);
  assert.equal(createOrder(projectId, { ref: '1001', phone: '0550000001' }, { source: 'api' }).created, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE ref IN ('1001', 'SH-77')").get().n, 0);
  // سجل النشاط يحفظ ما حُذف
  const log = db.prepare("SELECT details FROM audit_log WHERE action = 'orders_bulk_deleted' ORDER BY id DESC").get();
  assert.deepEqual(JSON.parse(log.details).refs.sort(), ['#1001', 'SH-77']);
});

test('bulk delete of customers: all their orders go, the blacklist stays', async () => {
  const phone = '0661000002';
  order({ phone });
  order({ phone, status: 'abandoned' }, 'sheet');
  setCustomerFlag(phone, { blacklisted: true, reason: 'test' });
  const r = await admin('POST', '/customers/bulk/delete', { body: { phones: [phone] }, sensitive: SENS });
  assert.deepEqual([r.status, r.json], [200, { customers: 1, deleted: 2 }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE phone = ?').get(phone).n, 0);
  assert.equal(db.prepare('SELECT blacklisted FROM customer_flags WHERE phone = ?').get(phone).blacklisted, 1);
  // الطلبية اليدوية الجديدة من نفس الرقم تُنشأ عادياً وتُوسم «القائمة السوداء»
  const fresh = createOrder(projectId, { phone, items: [{ title: 'T', qty: 1, price: 1000 }] }, { source: 'manual' });
  assert.equal(fresh.created, true);
  assert.match(db.prepare('SELECT tags FROM orders WHERE id = ?').get(fresh.id).tags, /blacklist/);
});
