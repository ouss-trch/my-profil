import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { changeStatus, createOrder, getOrder, upsertFromShopify } from '../server/services/orders.js';
import { drain } from '../server/services/effects.js';
import { connectionCheck, tokenLife } from '../server/integrations/meta.js';
import { activeTestCode, sendTestEvent, TEST_CODE_TTL_MS } from '../server/services/capi.js';

const p = createProject({ name: 'CAPI shop', domain: 'capi.example' });
for (const [k, v] of [
  ['meta_access_token', 'EAAtest'],
  ['meta_pixel_id', '2111277745999858'],
  ['meta_ad_account_ids', ['514592591530411']],
  ['meta_page_id', '777'],
  ['meta_capi_confirmed', true],
  ['meta_capi_delivered', true],
])
  setSetting(k, v, p.id);

// Meta وهمي: يسجّل كل حدث، ويقبل أو يرفض حسب الحاجة
const sent = [];
let reject = null;
let scopes = ['ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];
let tokenExtra = {};
globalThis.fetch = async (url, init = {}) => {
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const u = new URL(String(url));
  if (u.pathname.endsWith('/2111277745999858/events')) {
    const form = new URLSearchParams(init.body);
    if (reject) return json({ error: { message: reject, type: 'OAuthException', code: 100 } }, 400);
    sent.push({ data: JSON.parse(form.get('data')), test: form.get('test_event_code'), token: form.get('access_token') });
    return json({ events_received: 1, messages: [], fbtrace_id: 'trace' });
  }
  if (u.pathname.endsWith('/debug_token')) return json({ data: { app_id: '42', application: 'Toureche ERP', is_valid: true, expires_at: 0, scopes, ...tokenExtra } });
  if (u.pathname.endsWith('/act_514592591530411')) return json({ id: 'act_514592591530411', name: 'ADcompte 1', account_status: 1, currency: 'USD' });
  if (u.pathname.endsWith('/2111277745999858/stats')) return json({ data: [{ data: [{ value: 'Purchase', count: 3 }] }] });
  if (u.pathname.endsWith('/2111277745999858')) return json({ id: '2111277745999858', name: 'SOU9NA', last_fired_time: '2026-10-27T21:33:16+0000' });
  if (u.pathname.endsWith('/777')) return json({ id: '777', name: 'SOU9NA page' });
  throw new Error(`unexpected ${url}`);
};

// تجزئة نموذج الطلب في المتجر (assets/cod-form.js) كما هي: الهاتف 213…، الاسم الأول، الباقي، البلدية اللاتينية
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const theme = (phone, name, communeLatin) => {
  const [fn, ...ln] = name.trim().split(/\s+/);
  return { ph: sha(`213${phone.slice(1)}`), fn: sha(fn.toLowerCase()), ln: sha(ln.join(' ').toLowerCase()), ct: sha(communeLatin.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')), country: sha('dz') };
};

let n = 0;
const order = (extra = {}, source = 'shopify') =>
  createOrder(
    p.id,
    {
      ref: `RW-T${++n}`,
      customer_name: 'Amine Ben Ali',
      phone: '0550123456',
      wilaya: 19,
      commune: 'بابور',
      commune_fr: 'Babor',
      items: [{ title: 'Thermos', qty: 1, price: 4990, shopify_product_id: 'gid://shopify/Product/15584895959234' }],
      shipping_fee: 400,
      landing_url: 'https://capi.example/products/thermos?utm_source=fb',
      meta_event_id: 'mvr74qmy6swt1ov4',
      ...extra,
    },
    { source },
  ).id;

test('capi: a confirmed order reaches Meta once, linked to the store’s Purchase, with the same hashed identity as the order form', async () => {
  const id = order();
  const o = getOrder(id);
  changeStatus(id, 'confirmed');
  await drain();
  assert.equal(sent.length, 1);
  const [ev] = sent[0].data;
  assert.deepEqual([ev.event_name, ev.action_source, ev.event_id], ['OrderConfirmed', 'phone_call', `confirmed-${o.ref}`]);
  const t = theme('0550123456', 'Amine Ben Ali', 'Babor');
  assert.deepEqual(ev.user_data.ph, [t.ph]);
  assert.deepEqual(ev.user_data.external_id, [t.ph], 'same external_id as the Purchase');
  assert.deepEqual([ev.user_data.fn, ev.user_data.ln, ev.user_data.ct, ev.user_data.country], [[t.fn], [t.ln], [t.ct], [t.country]]);
  assert.deepEqual(ev.user_data.st, [sha('setif')], 'wilaya in plain Latin letters');
  assert.deepEqual(ev.custom_data, { currency: 'DZD', value: 5390, order_id: o.ref, content_ids: ['15584895959234'], content_type: 'product', num_items: 1 });
  assert.deepEqual(ev.original_event_data, { event_name: 'Purchase', event_time: Math.floor(Date.parse(o.created_at) / 1000), order_id: o.ref, event_id: 'mvr74qmy6swt1ov4' });
  assert.ok(Math.abs(ev.event_time - Date.now() / 1000) < 60, 'the time of the confirmation itself (Meta refuses > 7 days)');
  assert.equal(sent[0].test, null);
  // التراجع عن الحالة ثم التأكيد من جديد: لا يُرسل مرتين
  changeStatus(id, 'new', { force: true });
  changeStatus(id, 'confirmed');
  await drain();
  assert.equal(sent.length, 1);
  // التسليم: حدث ثانٍ «سُلّمت» (الدفع عند الباب)
  changeStatus(id, 'shipped');
  changeStatus(id, 'delivered', { force: true });
  await drain();
  assert.deepEqual([sent[1].data[0].event_name, sent[1].data[0].action_source, sent[1].data[0].event_id], ['OrderDelivered', 'other', `delivered-${o.ref}`]);
  // سجل الطلبية يقول ما أُرسل
  const log = getOrder(id).events.filter((e) => e.type === 'meta').map((e) => [e.raw, e.note]);
  assert.deepEqual(log, [['OrderConfirmed', 'ok'], ['OrderDelivered', 'ok']]);
});

test('capi: off by default per event, never for a phone order with no ad click, and test mode does not count as sent', async () => {
  sent.length = 0;
  setSetting('meta_capi_delivered', false, p.id);
  const a = order();
  changeStatus(a, 'confirmed');
  changeStatus(a, 'shipped');
  changeStatus(a, 'delivered', { force: true });
  await drain();
  assert.deepEqual(sent.map((s) => s.data[0].event_name), ['OrderConfirmed']);
  setSetting('meta_capi_delivered', true, p.id);

  sent.length = 0;
  const manual = order({ landing_url: null, meta_event_id: null }, 'manual');
  changeStatus(manual, 'confirmed');
  await drain();
  assert.equal(sent.length, 0, 'phone order: no ad click to attribute');

  // رمز «اختبار الأحداث»: الحدث يظهر في Events Manager فقط، ولا يُعدّ مرسلاً
  setSetting('meta_test_event_code', 'TEST4321', p.id);
  const b = order();
  changeStatus(b, 'confirmed');
  await drain();
  assert.equal(sent.at(-1).test, 'TEST4321');
  setSetting('meta_test_event_code', '', p.id);
  changeStatus(b, 'new', { force: true });
  changeStatus(b, 'confirmed');
  await drain();
  assert.equal(sent.at(-1).test, null, 'sent for real once the test code is removed');
  assert.deepEqual(getOrder(b).events.filter((e) => e.type === 'meta').map((e) => e.note), ['test', 'ok']);

  // رفض Meta يُكتب في السجل ولا يُعدّ مرسلاً
  reject = 'Invalid parameter';
  const c = order();
  changeStatus(c, 'confirmed');
  await drain();
  reject = null;
  assert.match(getOrder(c).events.find((e) => e.type === 'meta').note, /^error: .*Invalid parameter/);
});

test('capi: the store’s event_id reaches the order from Shopify attributes', () => {
  const money = { subtotal: 4990, discount: 0, shipping_fee: 400, total: 5390 };
  const r = upsertFromShopify(p.id, { external_id: 'gid://shopify/Order/77', shopify_name: '#1077', ref: 'RW-SHOP77', phone: '0550123456', items: [], tags: [], ...money, meta_event_id: 'mvabc123def' });
  assert.equal(db.prepare('SELECT meta_event_id FROM orders WHERE id = ?').get(r.id).meta_event_id, 'mvabc123def');
  // طلبية الجدول وصلت قبل Shopify: يُستكمل المعرّف
  const id = order({ ref: 'RW-SHEET9', meta_event_id: null }, 'sheet');
  upsertFromShopify(p.id, { external_id: 'gid://shopify/Order/78', shopify_name: '#1078', ref: 'RW-SHEET9', phone: '0550123456', items: [], tags: [], ...money, meta_event_id: 'mvsheet9xx' });
  assert.equal(db.prepare('SELECT meta_event_id FROM orders WHERE id = ?').get(id).meta_event_id, 'mvsheet9xx');
  assert.equal(order({ meta_event_id: "x'; DROP" }) && db.prepare('SELECT meta_event_id FROM orders ORDER BY id DESC LIMIT 1').get().meta_event_id, null, 'only plain ids are kept');
});

test('meta check: the token, its permissions, the accounts, pixel and page, and a test event, each with what is missing', async () => {
  sent.length = 0;
  const cfg = (await import('../server/lib/settings.js')).projectConfig(p.id);
  const r = await connectionCheck(cfg, { capiTest: () => sendTestEvent(p.id, 'TEST9') });
  assert.deepEqual(r.app, { id: '42', name: 'Toureche ERP' });
  assert.deepEqual(r.token, { valid: true, type: null, expires_at: 0, data_access_expires_at: null, never_expires: true, ends_at: null, days_left: null });
  assert.deepEqual(r.scopes.missing, ['ads_management'], 'campaigns cannot be launched without it');
  assert.ok(r.scopes.optional_missing.includes('pages_manage_posts'));
  assert.deepEqual(r.accounts, [{ id: '514592591530411', name: 'ADcompte 1', status: 1, ok: true }]);
  assert.equal(r.pixel.ok, true);
  assert.deepEqual(r.pixel.events_24h, [{ name: 'Purchase', count: 3 }]);
  assert.deepEqual(r.page, { id: '777', name: 'SOU9NA page', ok: true, token: false });
  assert.deepEqual(r.capi, { ok: true, events_received: 1, fbtrace_id: 'trace', token: 'general' });
  assert.equal(sent.at(-1).test, 'TEST9');
  scopes = [...scopes, 'ads_management'];
  assert.deepEqual((await connectionCheck(cfg)).scopes.missing, []);
  // رمز مستخدم من Graph API Explorer بعد «Extend Access Token»: ينتهي بعد نحو شهرين، والواجهة تعرض التاريخ لا «لا ينتهي»
  const sixtyDays = Math.floor(Date.now() / 1000) + 60 * 86400;
  tokenExtra = { type: 'USER', expires_at: sixtyDays, data_access_expires_at: sixtyDays + 30 * 86400 };
  const user = (await connectionCheck(cfg)).token;
  assert.deepEqual([user.type, user.never_expires, user.ends_at, user.days_left], ['USER', false, sixtyDays, 60], 'the earlier of the two dates, in whole days');
  tokenExtra = {};
  await assert.rejects(sendTestEvent(p.id, ''), (e) => e.code === 'capi_test_code_required');
});

test('token life: the earliest date wins, a token that never expires but whose data access ends is not “permanent”, and an unreported date is unknown', () => {
  const now = Date.UTC(2026, 9, 28) ;
  const sec = (days) => Math.floor(now / 1000) + days * 86400;
  // رمز System User بمدة Never: لا تاريخ
  assert.deepEqual(tokenLife({ type: 'SYSTEM_USER', expires_at: 0, data_access_expires_at: 0 }, now), { type: 'SYSTEM_USER', expires_at: 0, data_access_expires_at: 0, never_expires: true, ends_at: null, days_left: null });
  // رمز مستخدم: ينتهي بعد 60 يوماً ووصول البيانات بعد 90: الأبكر
  const user = tokenLife({ type: 'USER', expires_at: sec(60), data_access_expires_at: sec(90) }, now);
  assert.deepEqual([user.never_expires, user.ends_at, user.days_left], [false, sec(60), 60]);
  // الرمز دائم لكن وصول التطبيق للبيانات ينتهي بعد 45 يوماً: لا يُعرض «دائماً»
  const data = tokenLife({ type: 'USER', expires_at: 0, data_access_expires_at: sec(45) }, now);
  assert.deepEqual([data.never_expires, data.ends_at, data.days_left], [true, sec(45), 45]);
  // انتهى بالأمس
  assert.equal(tokenLife({ expires_at: sec(-1) }, now).days_left, -1);
  // الرد لا يذكر expires_at (رموز بعض الأنواع): مجهول، لا «ينتهي»
  assert.deepEqual(tokenLife({ type: 'PAGE', is_valid: true }, now), { type: 'PAGE', expires_at: null, data_access_expires_at: null, never_expires: null, ends_at: null, days_left: null });
  assert.equal(tokenLife(null).never_expires, null);
});

test('test code: it works for a few hours, then production events resume on their own (a forgotten code must not swallow them)', async () => {
  sent.length = 0;
  setSetting('meta_test_event_code', 'TEST777', p.id);
  const fresh = activeTestCode(p.id);
  assert.deepEqual([fresh.code, fresh.set, fresh.expired], ['TEST777', true, false]);
  assert.ok(Date.parse(fresh.until) - Date.now() > TEST_CODE_TTL_MS - 5000, 'the deadline is shown to the owner');
  const a = order();
  changeStatus(a, 'confirmed');
  await drain();
  assert.equal(sent.at(-1).test, 'TEST777');
  // مرّت 4 ساعات على حفظه: يتوقف، وتذهب الأحداث إلى الإنتاج
  db.prepare("UPDATE settings SET updated_at = ? WHERE key = 'meta_test_event_code'").run(new Date(Date.now() - 4 * 3600e3).toISOString());
  const late = activeTestCode(p.id);
  assert.deepEqual([late.code, late.set, late.expired], ['', true, true]);
  const b = order();
  changeStatus(b, 'confirmed');
  await drain();
  assert.equal(sent.at(-1).test, null);
  assert.deepEqual(getOrder(b).events.filter((e) => e.type === 'meta').map((e) => e.note), ['ok']);
  // وحفظه من جديد يفتح مهلة جديدة
  setSetting('meta_test_event_code', 'TEST777', p.id);
  assert.equal(activeTestCode(p.id).expired, false);
  setSetting('meta_test_event_code', '', p.id);
  assert.deepEqual(activeTestCode(p.id), { code: '', set: false, until: null, expired: false });
});

test('capi token: the pixel’s own token carries the ERP events when set (so a user token that expires or dies does not stop them), the general one otherwise', async () => {
  sent.length = 0;
  const cfgOf = () => import('../server/lib/settings.js').then((m) => m.projectConfig(p.id));
  await sendTestEvent(p.id, 'TEST1');
  assert.equal(sent.at(-1).token, 'EAAtest', 'no dedicated token: the general one');
  setSetting('meta_capi_token', 'EAAcapi-dataset', p.id);
  await sendTestEvent(p.id, 'TEST2');
  assert.equal(sent.at(-1).token, 'EAAcapi-dataset');
  const a = order();
  changeStatus(a, 'confirmed');
  await drain();
  assert.equal(sent.at(-1).token, 'EAAcapi-dataset', 'real order events too');
  const r = await connectionCheck(await cfgOf(), { capiTest: () => sendTestEvent(p.id, 'TEST3') });
  assert.equal(r.capi.token, 'capi', 'the check says which token carried the test event');
  setSetting('meta_capi_token', '', p.id);
  await sendTestEvent(p.id, 'TEST4');
  assert.equal(sent.at(-1).token, 'EAAtest', 'clearing it goes back to the general token');
});
