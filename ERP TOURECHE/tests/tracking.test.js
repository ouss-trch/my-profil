import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { createOrder } from '../server/services/orders.js';
import * as splits from '../server/services/splits.js';
import { pageKey, recordVisit, sourceOf, trafficReport, visitorsWhere } from '../server/services/tracking.js';
import { dzDay } from '../server/lib/util.js';
import { createApp } from '../server/app.js';

const realFetch = globalThis.fetch;

const project = createProject({ name: 'Sou9na track', slug: 'sou9na-track', domain: 'souqnna.example' });
const product = createProduct(project.id, { title: 'ترمس ميكي', price: 5900 });
db.prepare("UPDATE products SET handle = 'thermos-enfant' WHERE id = ?").run(product.id);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]';

test('tracking: one page key for the same page (locale, collection path, case, view)', () => {
  assert.equal(pageKey('https://souqnna.com/fr/collections/kids/products/Thermos-Enfant/?variant=1&view=LP-cadeau'), '/products/thermos-enfant?view=lp-cadeau');
  assert.equal(pageKey('/products/%D8%AA%D8%B1%D9%85%D8%B3'), '/products/ترمس');
  assert.equal(pageKey('https://souqnna.com/fr'), '/');
  assert.equal(pageKey('https://souqnna.com/'), '/');
  assert.equal(pageKey('%%bad'), '/%%bad');
  assert.equal(pageKey(''), null);
});

test('tracking: where the visitor came from', () => {
  const p = (q) => new URLSearchParams(q);
  assert.equal(sourceOf(p('fbclid=x'), '', 'souqnna.com'), 'meta');
  assert.equal(sourceOf(p('utm_source=ig'), '', 'souqnna.com'), 'meta');
  assert.equal(sourceOf(p('gclid=1'), '', 'souqnna.com'), 'google');
  assert.equal(sourceOf(p('utm_source=newsletter'), '', 'souqnna.com'), 'campaign');
  assert.equal(sourceOf(p(''), 'https://www.souqnna.com/collections/kids', 'souqnna.com'), 'internal');
  assert.equal(sourceOf(p(''), 'https://l.facebook.com/', 'souqnna.com'), 'social');
  assert.equal(sourceOf(p(''), 'https://www.google.dz/', 'souqnna.com'), 'search');
  assert.equal(sourceOf(p(''), '', 'souqnna.com'), 'direct');
});

test('tracking: humans counted once per page and day, bots and unknown projects ignored, form start kept', () => {
  const page = '/products/thermos-enfant?view=lp-cadeau&fbclid=abc&variant=7';
  assert.equal(recordVisit('sou9na-track', { e: 'v', u: page, vid: '0123456789abcdef', r: 'https://l.facebook.com/', t: 'product' }, IPHONE), true);
  assert.equal(recordVisit('sou9na-track', { e: 'v', u: page, vid: '0123456789abcdef' }, IPHONE), true);
  assert.equal(recordVisit('sou9na-track', { e: 'f', u: page, vid: '0123456789abcdef' }, IPHONE), true);
  // هاتف Cubot ليس روبوتاً؛ زاحف Meta وPageSpeed روبوتات
  assert.equal(recordVisit('sou9na-track', { e: 'v', u: page, vid: '1111111111111111' }, 'Mozilla/5.0 (Linux; Android 13; Cubot X30) AppleWebKit/537.36 Chrome/124 Mobile'), true);
  assert.equal(recordVisit('sou9na-track', { e: 'v', u: page, vid: '2222222222222222' }, 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'), false);
  assert.equal(recordVisit('sou9na-track', { e: 'v', u: page, vid: '3333333333333333' }, 'Mozilla/5.0 (Linux; Android 11; moto g power) Chrome-Lighthouse'), false);
  assert.equal(recordVisit('unknown-shop', { e: 'v', u: page, vid: '4444444444444444' }, IPHONE), false);
  assert.equal(recordVisit('sou9na-track', { e: 'x', u: page }, IPHONE), false);
  assert.equal(recordVisit('../etc', { e: 'v', u: page }, IPHONE), false);
  const rows = db.prepare('SELECT * FROM page_visits WHERE project_id = ? ORDER BY visitor').all(project.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.page, r.visitor, r.views, r.form, r.from_ad, r.source, r.page_type]),
    [
      ['/products/thermos-enfant?view=lp-cadeau', '0123456789abcdef', 2, 1, 1, 'meta', 'product'],
      ['/products/thermos-enfant?view=lp-cadeau', '1111111111111111', 1, 0, 1, 'meta', null],
    ],
  );
});

test('tracking: orders belong to the page they were sent from, not to a stale utm_content (live bug #1042–#1044)', () => {
  const t = splits.createTest(project.id, {
    name: 'thermos-live',
    product_id: product.id,
    variants: [
      { url: 'https://souqnna.example/products/thermos-enfant', weight: 1 },
      { url: 'https://souqnna.example/products/thermos-enfant?view=lp-solution', weight: 1 },
      { url: 'https://souqnna.example/products/thermos-enfant?view=lp-cadeau', weight: 1 },
    ],
  });
  splits.updateTest(t.id, { status: 'running' });
  const order = (ref, landing, utm) => createOrder(project.id, { ref, phone: '0550123456', wilaya: 19, items: [{ title: 'T', qty: 1, price: 5900 }], landing_url: landing, utm_content: utm });
  // زار النسخة C (المشكلة والحل) من رابط الاختبار وطلب منها
  order('L-1', `https://souqnna.example/products/thermos-enfant?view=lp-solution&utm_content=${t.slug}-b&erp_v=${t.slug}.B&variant=1`, `${t.slug}-b`);
  // ثم فتح رابط صفحة الهدية وطلب مرتين: نموذج الطلب أرسل utm_content القديم
  order('L-2', 'https://souqnna.example/products/thermos-enfant?view=lp-cadeau&variant=1', `${t.slug}-b`);
  order('L-3', 'https://souqnna.example/products/thermos-enfant?view=lp-cadeau&variant=2', `${t.slug}-b`);
  // زوار: واحد من رابط الاختبار على النسخة B، واثنان مباشرة على صفحة الهدية
  recordVisit('sou9na-track', { e: 'v', u: `/products/thermos-enfant?view=lp-solution&erp_v=${t.slug}.B&fbclid=1`, vid: 'aaaaaaaaaaaaaaaa' }, IPHONE);
  recordVisit('sou9na-track', { e: 'v', u: '/products/thermos-enfant?view=lp-cadeau', vid: 'bbbbbbbbbbbbbbbb' }, IPHONE);
  const r = splits.results(t.id);
  const [a, b, c] = ['A', 'B', 'C'].map((l) => r.variants.find((v) => v.label === l));
  assert.deepEqual([a.orders, b.orders, c.orders], [0, 1, 0], 'test orders: only the one sent from the B page with erp_v');
  assert.deepEqual([a.visitors, b.visitors, c.visitors], [0, 1, 0]);
  // صفحة الهدية كلها: زائرا العدّ (اختبار القسم السابق + هذا) وطلبيتاها، خارج الحكم
  assert.equal(c.page.all.orders, 2);
  assert.equal(c.page.direct.orders, 2);
  assert.equal(c.page.all.visitors, visitorsWhere(project.id, { page: '/products/thermos-enfant?view=lp-cadeau', sinceDay: dzDay() }).visitors);
  assert.equal(b.page.direct.orders, 0);
  assert.equal(b.page.all.orders, 1);
});

test('tracking: traffic report per page with landing angle names, conversion and sources', () => {
  db.prepare("INSERT INTO landing_pages (project_id, product_id, slug, angle, framework, copy, created_at, updated_at) VALUES (?, ?, 'cadeau', 'هدية', 'aida', '{}', ?, ?)").run(project.id, product.id, new Date().toISOString(), new Date().toISOString());
  recordVisit('sou9na-track', { e: 'v', u: '/products/thermos-enfant', vid: 'cccccccccccccccc', r: 'https://souqnna.example/collections/kids' }, IPHONE);
  recordVisit('sou9na-track', { e: 'v', u: '/', vid: 'cccccccccccccccc' }, IPHONE);
  const rep = trafficReport([project.id], { days: 7 });
  const gift = rep.pages.find((p) => p.key === '/products/thermos-enfant?view=lp-cadeau');
  assert.equal(gift.kind, 'landing');
  assert.equal(gift.label, 'هدية');
  assert.equal(gift.sub, 'ترمس ميكي');
  assert.equal(gift.orders, 2);
  assert.equal(gift.visitors, 3);
  assert.equal(gift.conversion, 66.67);
  assert.equal(gift.form, 1);
  const productPage = rep.pages.find((p) => p.key === '/products/thermos-enfant');
  assert.deepEqual([productPage.kind, productPage.label, productPage.visitors], ['product', 'ترمس ميكي', 1]);
  assert.equal(rep.pages.find((p) => p.key === '/').kind, 'home');
  assert.equal(rep.totals.orders, 3);
  assert.equal(rep.totals.visitors, 5);
  assert.ok(rep.sources.find((s) => s.source === 'meta').visitors >= 2);
  assert.equal(rep.daily.length, 7);
  assert.equal(rep.daily.at(-1).orders, 3);
  assert.ok(rep.health.last_visit_at);
});

test('tracking: the public beacon answers 204 cross-origin and is not throttled by the hooks limit (shared mobile IPs)', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/hooks/sp/sou9na-track`;
    const send = (vid) => realFetch(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://souqnna.example', 'user-agent': IPHONE }, body: JSON.stringify({ e: 'v', u: '/pages/livraison', vid }) });
    const r = await send('dddddddddddddddd');
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    // 130 زيارة من نفس العنوان في دقيقة (CGNAT): كلها تُقبل
    const all = await Promise.all(Array.from({ length: 130 }, (_, i) => send(i.toString(16).padStart(16, 'e'))));
    assert.ok(all.every((x) => x.status === 204));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM page_visits WHERE project_id = ? AND page = '/pages/livraison'").get(project.id).n, 131);
    // جسم غير صالح: 204 دون تسجيل ولا خطأ
    const bad = await realFetch(url, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': IPHONE }, body: '{oops' });
    assert.equal(bad.status, 204);
  } finally {
    server.close();
  }
});

test('tracking: an installed but outdated theme snippet is refreshed automatically; never installed stays a decision', async () => {
  const calls = [];
  let snippet = '{% comment %} v1 {% endcomment %}<script>var C=1;t.p.replace()</script>';
  let layout = "<html><head>\n    {% render 'erp-split' %}</head></html>";
  globalThis.fetch = async (url, init = {}) => {
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    const body = JSON.parse(init.body);
    calls.push(body.query.trim().slice(0, 40));
    if (body.query.includes('themes(first: 1')) return json({ data: { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/1', name: 'sou9na' }] } } });
    if (body.query.includes('theme(id:')) return json({ data: { theme: { files: { nodes: [{ filename: 'layout/theme.liquid', body: { content: layout } }, { filename: 'snippets/erp-split.liquid', body: { content: snippet } }] } } } });
    if (body.query.includes('themeFilesUpsert')) {
      snippet = body.variables.files[0].body.value;
      return json({ data: { themeFilesUpsert: { upsertedThemeFiles: body.variables.files.map((f) => ({ filename: f.filename })), userErrors: [] } } });
    }
    if (body.query.includes('shop { id }')) return json({ data: { shop: { id: 'gid://shopify/Shop/1' } } });
    if (body.query.includes('metafieldsSet')) {
      calls.push(`config:${body.variables.m[0].value}`);
      return json({ data: { metafieldsSet: { metafields: [{ id: 'm1' }], userErrors: [] } } });
    }
    throw new Error(`unexpected ${body.query.slice(0, 60)}`);
  };
  setSetting('shopify_shop', 'track-test.myshopify.com', project.id);
  setSetting('shopify_access_token', 'shpat_test', project.id);
  const first = await splits.ensureTracking(project.id);
  assert.deepEqual(first, { state: 'ok', updated: true });
  assert.equal(snippet, splits.snippetLiquid());
  const conf = JSON.parse(calls.find((c) => c.startsWith('config:')).slice(7));
  assert.equal(conf.v, 3);
  assert.equal(conf.k, 'sou9na-track');
  // مرة ثانية: السنيبت محدّث، تُكتب الإعدادات فقط
  assert.deepEqual(await splits.ensureTracking(project.id), { state: 'ok', updated: false });
  // قالب جديد بلا سطر التثبيت: لا يُلمس (التثبيت بكلمة المرور الحساسة)
  layout = '<html><head></head></html>';
  const before = calls.filter((c) => c.includes('themeFilesUpsert')).length;
  assert.deepEqual(await splits.ensureTracking(project.id), { state: 'not_installed' });
  assert.equal(calls.filter((c) => c.includes('themeFilesUpsert')).length, before);
});
