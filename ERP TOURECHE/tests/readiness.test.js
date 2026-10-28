import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { localChecks, readiness, clearReadiness } from '../server/services/readiness.js';

const p = createProject({ name: 'Ready shop', domain: 'ready.example' });
const by = (items) => Object.fromEntries(items.map((i) => [i.key, i]));
const DAY = 864e5;
const sec = (days) => Math.floor((Date.now() + days * DAY) / 1000);

test('readiness (local): a bare project is not ready, and each line says why', () => {
  const r = by(localChecks(p.id));
  assert.equal(r.shopify.state, 'bad');
  assert.equal(r.products.state, 'bad');
  assert.equal(r.meta_connected.state, 'bad');
  assert.equal(r.meta_token.state, 'unknown', 'nothing to judge without Meta');
  assert.equal(r.test_code.state, 'ok');
  assert.equal(r.attribution.state, 'unknown', 'no orders yet: no verdict');
  assert.equal(r.visits.state, 'unknown');
});

test('readiness (local): token days, a dead token, the test code and the token that carries the ERP events', () => {
  for (const [k, v] of [
    ['meta_access_token', 'EAAready'],
    ['meta_ad_account_ids', ['1021341893008834']],
  ])
    setSetting(k, v, p.id);
  const state = (patch) => setSetting('meta_token_state', { checked_at: new Date().toISOString(), valid: true, type: 'USER', expires_at: null, data_access_expires_at: null, ends_at: null, ...patch }, p.id);
  state({ ends_at: sec(60) });
  let r = by(localChecks(p.id));
  assert.deepEqual([r.meta_connected.state, r.meta_token.state, r.meta_token.value], ['ok', 'ok', 60]);
  assert.equal(r.capi_token.state, 'warn', 'a user token that ends in 60 days carries the ERP events');
  setSetting('meta_capi_token', 'EAAcapi', p.id);
  assert.equal(by(localChecks(p.id)).capi_token.state, 'ok', 'the pixel’s own token fixes that');
  state({ ends_at: sec(9) });
  r = by(localChecks(p.id));
  assert.deepEqual([r.meta_token.state, r.meta_token.value], ['warn', 9]);
  state({ valid: false });
  assert.equal(by(localChecks(p.id)).meta_token.state, 'bad');
  state({ type: 'SYSTEM_USER', expires_at: 0 });
  setSetting('meta_capi_token', '', p.id);
  r = by(localChecks(p.id));
  assert.deepEqual([r.meta_token.state, r.capi_token.state], ['ok', 'ok'], 'a permanent token needs no dedicated one');
  setSetting('meta_test_event_code', 'TEST1', p.id);
  assert.equal(by(localChecks(p.id)).test_code.state, 'warn');
  setSetting('meta_test_event_code', '', p.id);
});

test('readiness (local): products, ERP events and attribution of real orders', () => {
  const prod = createProduct(p.id, { title: 'Mug', handle: 'mug' });
  db.prepare("UPDATE products SET shopify_id = 'gid://shopify/Product/1', shopify_status = 'ACTIVE' WHERE id = ?").run(prod.id);
  setSetting('meta_capi_confirmed', true, p.id);
  let r = by(localChecks(p.id));
  assert.deepEqual([r.products.state, r.products.value, r.capi_events.state], ['ok', 1, 'ok']);
  // طلبيات بلا رابط الصفحة: النسب مكسور
  const now = new Date().toISOString();
  for (let i = 0; i < 4; i++)
    db.prepare("INSERT INTO orders (project_id, ref, customer_name, phone, status, total, created_at, updated_at, items) VALUES (?, ?, 'x', '0550000000', 'new', 1000, ?, ?, '[]')").run(p.id, `RD-${i}`, now, now);
  assert.equal(by(localChecks(p.id)).attribution.state, 'bad');
  db.prepare("UPDATE orders SET landing_url = 'https://ready.example/products/mug' WHERE project_id = ?").run(p.id);
  r = by(localChecks(p.id));
  assert.deepEqual([r.attribution.state, r.attribution.value], ['ok', '4/4']);
});

test('readiness: the full list adds the store pages and the ad account, and is ready only without a blocker', async () => {
  clearReadiness();
  setSetting('meta_pixel_id', '2111277745999858', p.id);
  setSetting('store_domain', 'ready.example', p.id);
  db.prepare("UPDATE products SET online_url = 'https://ready.example/products/mug' WHERE project_id = ?").run(p.id);
  const page = (extra = '') => `<html><head><link rel="canonical" href="https://ready.example/products/mug"><script>window.riwaq={pixelId:"2111277745999858"}</script></head><body><form data-lead-form></form>${extra}</body></html>`;
  let html = page();
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'ready.example') return new Response(html, { status: 200 });
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/debug_token')) return json({ data: { is_valid: true, expires_at: 0, type: 'SYSTEM_USER' } });
    if (u.pathname.endsWith('/act_1021341893008834')) return json({ id: 'act_1021341893008834', name: 'ADCompte 3', account_status: 1, currency: 'EUR', timezone_name: 'Africa/Algiers', funding_source_details: { display_string: 'Visa 4242' }, amount_spent: '0', spend_cap: '0' });
    if (u.pathname.endsWith('/2111277745999858/stats')) return json({ data: [] });
    if (u.pathname.endsWith('/2111277745999858')) return json({ id: '2111277745999858', name: 'SOU9NA', last_fired_time: new Date(Date.now() - 3600e3).toISOString() });
    return json({ data: [] });
  };
  let r = await readiness(p.id, { fresh: true });
  const m = by(r.items);
  assert.deepEqual([m.store_pages.state, m.ad_account.state, m.pixel_live.state], ['ok', 'ok', 'ok']);
  assert.equal(m.shopify.state, 'bad', 'Shopify itself is not connected in this fixture: that is a blocker');
  assert.equal(r.ready, false);
  assert.equal(r.counts.bad > 0, true);
  // الصفحة تفقد نموذج الطلب: تنبيه، لا مانع. وتفقد البيكسل: مانع
  html = '<html><head><link rel="canonical" href="https://ready.example/products/mug"></head><body></body></html>';
  r = await readiness(p.id, { fresh: true });
  assert.equal(by(r.items).store_pages.state, 'bad', 'no pixel on the page: every click would be paid and uncounted');
  assert.equal(by(r.items).store_pages.value, 'Mug', 'the product that fails is named');
  // نتيجة مخزّنة دقيقتين
  html = page();
  assert.equal(by((await readiness(p.id)).items).store_pages.state, 'bad', 'cached');
  assert.equal(by((await readiness(p.id, { fresh: true })).items).store_pages.state, 'ok');
});
