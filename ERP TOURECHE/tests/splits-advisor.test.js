import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { createOrder, changeStatus } from '../server/services/orders.js';
import * as splits from '../server/services/splits.js';
import * as advisor from '../server/services/advisor.js';

const project = createProject({ name: 'Split Test Shop', domain: 'shop.example' });
const product = createProduct(project.id, { title: 'Thermos 500ml', price: 2900, cost_price: 1200, stock: 25 });

test('split: needs at least two valid variants', () => {
  assert.throws(() => splits.createTest(project.id, { name: 'x', variants: [{ url: 'https://a.example' }] }), /split_needs_two_variants/);
  assert.throws(() => splits.createTest(project.id, { name: 'x', variants: [{ url: 'https://a.example' }, { url: 'javascript:alert(1)' }] }), /split_variant_url_invalid/);
});

test('split: weighted pick respects weights and stickiness', () => {
  const t = splits.createTest(project.id, {
    name: 'Thermos pages',
    product_id: product.id,
    variants: [
      { url: 'https://shop.example/products/thermos', weight: 3, name: 'Product page' },
      { url: 'https://shop.example/pages/thermos-lp', weight: 1, name: 'Landing' },
    ],
  });
  assert.equal(t.slug, 'thermos-pages');
  const counts = { A: 0, B: 0 };
  for (let i = 0; i < 4000; i++) counts[splits.pickVariant(t).label]++;
  const share = counts.A / 4000;
  assert.ok(share > 0.7 && share < 0.8, `A share ${share}`);
  // الزائر العائد يبقى على نفس الصفحة
  for (let i = 0; i < 50; i++) assert.equal(splits.pickVariant(t, 'B').label, 'B');
  // نسخة وزنها 0 لا تُختار
  const off = splits.updateTest(t.id, { variants: [{ url: t.variants[0].url, weight: 0 }, { url: t.variants[1].url, weight: 1 }] });
  for (let i = 0; i < 50; i++) assert.equal(splits.pickVariant(off).label, 'B');
});

test('split: route only counts while running, tags URL, keeps ad params, no cloaking for bots', () => {
  const t = splits.createTest(project.id, { name: 'Route test', mode: 'redirect', variants: [{ url: 'https://shop.example/a?x=1' }, { url: 'https://shop.example/b' }] });
  const draft = splits.route(t.slug, { query: {}, userAgent: 'Mozilla/5.0' });
  assert.equal(draft.cookies.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM split_clicks WHERE test_id = ?').get(t.id).n, 0);

  splits.updateTest(t.id, { status: 'running' });
  const r = splits.route(t.slug, { query: { fbclid: 'abc', utm_campaign: 'c1', evil: '<x>' }, userAgent: 'Mozilla/5.0 (iPhone)' });
  const u = new URL(r.location);
  assert.ok(['/a', '/b'].includes(u.pathname));
  assert.equal(u.searchParams.get('fbclid'), 'abc');
  assert.equal(u.searchParams.get('utm_campaign'), 'c1');
  assert.equal(u.searchParams.get('evil'), null);
  assert.match(u.searchParams.get('utm_content'), /^route-test-[ab]$/);
  assert.equal(r.cookies.length, 2);
  // زاحف Meta يُوجَّه بنفس التوزيع العشوائي (لا cloaking) لكنه لا يُحتسب كزائر
  const bot = splits.route(t.slug, { query: {}, userAgent: 'facebookexternalhit/1.1' });
  assert.ok(bot.location.startsWith('https://shop.example/'));
  assert.equal(bot.cookies.length, 0);
  const res = splits.results(t.id);
  assert.equal(res.variants.reduce((s, v) => s + v.visitors, 0), 1);
  assert.equal(res.variants.reduce((s, v) => s + v.bots, 0), 1);
  assert.equal(splits.route('does-not-exist', { query: {}, userAgent: 'x' }), null);
});

test('split: orders attributed by utm_content and winner detected with Bayesian probability', () => {
  const t = splits.createTest(project.id, { name: 'Winner', mode: 'redirect', goal: 'delivered', variants: [{ url: 'https://shop.example/w-a' }, { url: 'https://shop.example/w-b' }] });
  splits.updateTest(t.id, { status: 'running' });
  const [A, B] = t.variants;
  const insertClicks = (variant, n) => {
    const stmt = db.prepare('INSERT INTO split_clicks (test_id, variant_id, visitor, at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < n; i++) stmt.run(t.id, variant.id, `${variant.label}${String(i).padStart(15, '0')}`, new Date().toISOString());
  };
  insertClicks(A, 1000);
  insertClicks(B, 1000);
  const order = (label, i, delivered) => {
    const { id } = createOrder(project.id, { ref: `W-${label}-${i}`, phone: `055${String(1000000 + i).slice(-7)}`, wilaya: 16, items: [{ title: 'Thermos', qty: 1, price: 2900 }], utm_content: `winner-${label.toLowerCase()}` });
    changeStatus(id, 'confirmed', { force: true });
    changeStatus(id, delivered ? 'delivered' : 'returned', { force: true });
  };
  for (let i = 0; i < 40; i++) order('A', i, i < 32);
  for (let i = 0; i < 30; i++) order('B', 100 + i, i < 8);
  // فارق واضح لكن عمر الاختبار يوم واحد: الهدف «المسلّمة» يحتاج 14 يوماً (الطرود تعود متأخرة) ← «يتجه» لا «فائز»
  const early = splits.results(t.id);
  assert.equal(early.verdict, 'trending');
  assert.deepEqual(early.waiting.map((w) => w.key), ['days']);
  db.prepare('UPDATE split_tests SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 15 * 86400e3).toISOString(), t.id);
  db.prepare('UPDATE orders SET created_at = ? WHERE ref LIKE ?').run(new Date(Date.now() - 10 * 86400e3).toISOString(), 'W-%');
  const res = splits.results(t.id);
  const a = res.variants.find((v) => v.label === 'A');
  const b = res.variants.find((v) => v.label === 'B');
  assert.equal(a.orders, 40);
  assert.equal(a.delivered, 32);
  assert.equal(b.delivered, 8);
  assert.equal(res.verdict, 'winner');
  assert.equal(res.leader.label, 'A');
  assert.ok(a.p_best > 99);
  const p = splits.probabilityBest([{ successes: 10, trials: 100 }, { successes: 10, trials: 100 }], 20000);
  assert.ok(Math.abs(p[0] - 0.5) < 0.03, `equal arms ≈ 50/50, got ${p[0]}`);
});

test('advisor: produces evidence-backed insights and respects dismiss/snooze', () => {
  const a = advisor.analyze([project.id]);
  assert.deepEqual(a.errors, []);
  assert.ok(Array.isArray(a.insights));
  assert.ok(a.scores && 'overall' in a.scores);
  const winner = a.insights.find((i) => i.key.startsWith('split.winner:'));
  assert.ok(winner, 'split winner insight present');
  assert.ok(winner.title.ar && winner.title.fr && winner.evidence.length >= 2);
  const setup = a.insights.find((i) => i.key.startsWith('setup.missing'));
  assert.ok(setup, 'setup insight when integrations missing');
  advisor.setInsightState(project.id, winner.key, { status: 'snoozed', days: 2 });
  const b = advisor.analyze([project.id]);
  assert.equal(b.insights.find((i) => i.key === winner.key).hidden, true);
  advisor.setInsightState(project.id, winner.key, { status: null });
  assert.equal(advisor.analyze([project.id]).insights.find((i) => i.key === winner.key).hidden, false);
  // insights sorted by severity
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (let i = 1; i < b.insights.length; i++) assert.ok(order[b.insights[i - 1].severity] <= order[b.insights[i].severity]);
});

test('advisor: journal add/update/delete and done-note becomes decision', () => {
  const n = advisor.addJournal({ projectId: project.id, kind: 'lesson', text: 'Desk delivery converts better in 31' });
  assert.equal(n.kind, 'lesson');
  advisor.updateJournal(n.id, { pinned: true });
  advisor.setInsightState(project.id, 'confirm.backlog', { status: 'done', note: 'Hired a second confirmer' });
  const list = advisor.journal([project.id]);
  assert.equal(list[0].pinned, 1);
  assert.ok(list.some((j) => j.kind === 'decision' && j.text.includes('second confirmer')));
  assert.equal(advisor.deleteJournal(n.id), 1);
});

test('ads: a product without any ad spend is never judged a winner', async () => {
  const { productTest, decisions } = await import('../server/services/ads.js');
  const { getProduct } = await import('../server/services/products.js');
  const t = productTest(project.id, getProduct(product.id), 30);
  assert.equal(t.verdict, 'no_ads');
  assert.equal(t.cost_per_delivered_da, null);
  assert.ok(!decisions(project.id, 30).some((d) => d.kind === 'scale_budget'));
});

test('split (shopify mode): config for the theme snippet + weight-based estimation without visitor tracking', async () => {
  const t = splits.createTest(project.id, {
    name: 'Same domain',
    entry_path: 'https://shop.example/products/thermos-500/',
    variants: [
      { url: 'https://shop.example/products/thermos-500?view=angle-a', weight: 1 },
      { url: 'https://shop.example/pages/thermos-gift', weight: 3 },
    ],
  });
  assert.equal(t.mode, 'shopify');
  assert.equal(t.entry_path, '/products/thermos-500');
  assert.equal(splits.shopifyConfig(project.id).tests.find((x) => x.s === t.slug), undefined, 'draft tests are not published');
  splits.updateTest(t.id, { status: 'running' });
  const conf = splits.shopifyConfig(project.id).tests.find((x) => x.s === t.slug);
  assert.deepEqual(conf.v, [
    { l: 'A', u: '/products/thermos-500?view=angle-a', w: 1 },
    { l: 'B', u: '/pages/thermos-gift', w: 3 },
  ]);
  // الطلبيات فقط (دون عدّ الزوار): B أخذت 75% من الزوار وجلبت 30 طلبية، A أخذت 25% وجلبت 30 → A أفضل لكل زائر
  for (let i = 0; i < 30; i++) createOrder(project.id, { ref: `SD-A-${i}`, phone: '0550000001', wilaya: 16, items: [{ title: 'T', qty: 1, price: 1 }], utm_content: `${t.slug}-a` });
  for (let i = 0; i < 30; i++) createOrder(project.id, { ref: `SD-B-${i}`, phone: '0550000002', wilaya: 16, items: [{ title: 'T', qty: 1, price: 1 }], utm_content: `${t.slug}-b` });
  splits.updateTest(t.id, { goal: 'orders' });
  assert.equal(splits.results(t.id).waiting[0].key, 'days', 'no verdict before 7 days');
  db.prepare('UPDATE split_tests SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 8 * 86400e3).toISOString(), t.id);
  db.prepare('UPDATE orders SET created_at = ? WHERE ref LIKE ?').run(new Date(Date.now() - 86400e3).toISOString(), 'SD-%');
  const r = splits.results(t.id);
  assert.equal(r.estimation, 'weights');
  assert.equal(r.leader.label, 'A');
  assert.equal(r.verdict, 'winner');
  // رابط الإعلان = صفحة المنتج + مفتاح الاختبار؛ صفحة المنتج دون المفتاح لا تتغيّر لزوار المتجر
  assert.equal(r.test.public_url, `https://shop.example/products/thermos-500?erp_t=${t.slug}`);
  // اعتماد الفائز: الرابط يبقى يوجّه إليه بشكل دائم
  splits.updateTest(t.id, { winner_variant_id: r.leader.id, status: 'ended' });
  const ended = splits.shopifyConfig(project.id).tests.find((x) => x.s === t.slug);
  assert.deepEqual(ended.v, [{ l: 'A', u: '/products/thermos-500?view=angle-a', w: 1 }]);
  // سنيبت القالب: يقرأ metafield المتجر وكود JavaScript صالح
  const snippet = splits.snippetLiquid();
  assert.match(snippet, /shop\.metafields\.erp_toureche\.splits\.value/);
  const js = snippet.slice(snippet.indexOf('<script>') + 8, snippet.indexOf('</script>'));
  const run = (href, conf, { cookie = '', me = null, prerendering = false, designMode = false } = {}) => {
    const loc = new URL(href);
    const out = { replaced: null, beacons: [], listeners: {} };
    const store = { erp_vid: '0123456789abcdef', erp_me: me };
    const fake = { pathname: loc.pathname, search: loc.search, origin: loc.origin, replace: (u) => (out.replaced = u) };
    const doc = { cookie, referrer: 'https://l.facebook.com/', prerendering, documentElement: { style: {} }, addEventListener: (ev, fn) => (out.listeners[ev] = fn) };
    const code = js.replace('{{ erp_ab | json }}', JSON.stringify(conf)).replace('{{ request.page_type | json }}', '"product"');
    new Function('location', 'document', 'navigator', 'localStorage', 'window', code)(
      fake,
      doc,
      { sendBeacon: (u, b) => out.beacons.push({ url: u, ...JSON.parse(b) }) },
      { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) },
      designMode ? { Shopify: { designMode: true } } : {},
    );
    out.store = store;
    return out;
  };
  const live = { v: 3, b: 'https://erp.example/api/hooks', k: 'sou9na', tests: [{ s: 'thermos', st: 1, c: 1, v: [{ l: 'A', u: '/products/t', w: 1 }, { l: 'B', u: '/products/t?view=lp-cadeau', w: 1 }] }] };
  // زائر المتجر (من الأقسام): صفحة المنتج كما هي، وتُعدّ زيارة واحدة
  const shop = run('https://s.example/products/t', live);
  assert.equal(shop.replaced, null);
  assert.deepEqual(shop.beacons.map((b) => [b.url, b.e, b.u, b.vid, b.t]), [['https://erp.example/api/hooks/sp/sou9na', 'v', '/products/t', '0123456789abcdef', 'product']]);
  // أول لمسة لنموذج الطلب: «بدأ النموذج» مرة واحدة فقط
  const form = { closest: (sel) => (sel === '[data-lead-form]' ? {} : null) };
  shop.listeners.focusin({ target: form });
  shop.listeners.focusin({ target: form });
  shop.listeners.focusin({ target: { closest: () => null } });
  assert.deepEqual(shop.beacons.map((b) => b.e), ['v', 'f']);
  // رابط الإعلان: يوزَّع (utm_content الإعلان لا يُستبدل) ولا يُعدّ هنا — الصفحة الهدف تعدّ نفسها بـ erp_v
  const ad = run('https://s.example/products/t?erp_t=thermos&fbclid=1&utm_content=ad-7', live, { cookie: 'erp_sv_thermos=B' });
  assert.equal(ad.replaced, 'https://s.example/products/t?view=lp-cadeau&fbclid=1&utm_content=ad-7&erp_v=thermos.B');
  assert.deepEqual(ad.beacons, []);
  const landed = run(ad.replaced, live);
  assert.equal(landed.replaced, null);
  assert.equal(landed.beacons[0].u, '/products/t?view=lp-cadeau&fbclid=1&utm_content=ad-7&erp_v=thermos.B');
  // رابط صفحة هبوط بعينها: يبقى عليها ويُعدّ لها
  const direct = run('https://s.example/products/t?view=lp-cadeau', live);
  assert.equal(direct.replaced, null);
  assert.equal(direct.beacons.length, 1);
  // جهاز التاجر (?erp_me=1 مرة واحدة)، محرر القالب، والإعدادات القديمة: لا عدّ ولا تحويل
  const me = run('https://s.example/products/t?erp_me=1', live);
  assert.deepEqual([me.beacons.length, me.store.erp_me], [0, '1']);
  assert.equal(run('https://s.example/products/t', live, { me: '1' }).beacons.length, 0);
  assert.equal(run('https://s.example/products/t', live, { designMode: true }).beacons.length, 0);
  // تثبيت على الحاسوب (لا عنوان عام للـ ERP): الاختبار يعمل، والعدّ متوقف
  const local = run('https://s.example/products/t?erp_t=thermos', { ...live, b: null }, { cookie: 'erp_sv_thermos=A' });
  assert.deepEqual([local.replaced, local.beacons.length], ['https://s.example/products/t?erp_v=thermos.A', 0]);
  assert.equal(run('https://s.example/products/t', { ...live, b: null }).beacons.length, 0);
  assert.match(snippet, /\{%- if erp_ab\.b or erp_ab\.tests\.size > 0 -%\}/);
  const old = run('https://s.example/products/t?erp_t=thermos', { ...live, v: 2 });
  assert.deepEqual([old.replaced, old.beacons.length], [null, 0]);
  // صفحة محمّلة مسبقاً (prerender): تُعدّ عند فتحها فقط
  const pre = run('https://s.example/products/t', live, { prerendering: true });
  assert.equal(pre.beacons.length, 0);
  pre.listeners.prerenderingchange();
  assert.equal(pre.beacons.length, 1);
});

test('split: visit beacon is counted for humans and flagged for bots', () => {
  // السنيبت القديم (v2) كان يرسل هذه النقرات؛ النقطة باقية للقوالب التي لم تُحدَّث بعد
  const t = splits.createTest(project.id, { name: 'Beacon', mode: 'redirect', variants: [{ url: 'https://shop.example/bc-a' }, { url: 'https://shop.example/bc-b' }] });
  assert.equal(splits.recordHit(t.slug, { v: 'A', vid: '0123456789abcdef' }, 'Mozilla/5.0 (iPhone)'), false, 'not running → ignored');
  splits.updateTest(t.id, { status: 'running' });
  assert.equal(splits.recordHit(t.slug, { v: 'A', vid: '0123456789abcdef', ad: 1 }, 'Mozilla/5.0 (iPhone)'), true);
  assert.equal(splits.recordHit(t.slug, { v: 'B', vid: 'fedcba9876543210' }, 'facebookexternalhit/1.1'), true);
  assert.equal(splits.recordHit(t.slug, { v: 'Z' }, 'Mozilla/5.0'), false, 'unknown variant');
  const r = splits.results(t.id);
  const a = r.variants.find((v) => v.label === 'A');
  const b = r.variants.find((v) => v.label === 'B');
  assert.equal(a.visitors, 1);
  assert.equal(a.from_ad, 1);
  assert.equal(b.visitors, 0);
  assert.equal(b.bots, 1);
  // زيارة مباشرة لرابط النسخة: لا تدخل زوار الاختبار
  assert.equal(splits.recordHit(t.slug, { v: 'A', vid: 'aaaaaaaaaaaaaaaa', d: 1 }, 'Mozilla/5.0 (Android)'), true);
  assert.equal(splits.results(t.id).variants.find((v) => v.label === 'A').visitors, 1);
});
