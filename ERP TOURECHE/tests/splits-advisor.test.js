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
  const t = splits.createTest(project.id, { name: 'Route test', variants: [{ url: 'https://shop.example/a?x=1' }, { url: 'https://shop.example/b' }] });
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
  const t = splits.createTest(project.id, { name: 'Winner', goal: 'delivered', variants: [{ url: 'https://shop.example/a' }, { url: 'https://shop.example/b' }] });
  splits.updateTest(t.id, { status: 'running' });
  const [A, B] = t.variants;
  const insertClicks = (variant, n) => {
    const stmt = db.prepare('INSERT INTO split_clicks (test_id, variant_id, visitor, at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < n; i++) stmt.run(t.id, variant.id, `${variant.label}${i}`.padEnd(16, '0'), new Date().toISOString());
  };
  insertClicks(A, 400);
  insertClicks(B, 400);
  const order = (label, i, delivered) => {
    const { id } = createOrder(project.id, { ref: `W-${label}-${i}`, phone: `055${String(1000000 + i).slice(-7)}`, wilaya: 16, items: [{ title: 'Thermos', qty: 1, price: 2900 }], utm_content: `winner-${label.toLowerCase()}` });
    changeStatus(id, 'confirmed', { force: true });
    changeStatus(id, delivered ? 'delivered' : 'returned', { force: true });
  };
  for (let i = 0; i < 40; i++) order('A', i, i < 32);
  for (let i = 0; i < 12; i++) order('B', 100 + i, i < 8);
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
  const r = splits.results(t.id);
  assert.equal(r.estimation, 'weights');
  assert.equal(r.leader.label, 'A');
  assert.equal(r.verdict, 'winner');
  assert.equal(r.test.public_url, 'https://shop.example/products/thermos-500');
  // اعتماد الفائز: الرابط يبقى يوجّه إليه بشكل دائم
  splits.updateTest(t.id, { winner_variant_id: r.leader.id, status: 'ended' });
  const ended = splits.shopifyConfig(project.id).tests.find((x) => x.s === t.slug);
  assert.deepEqual(ended.v, [{ l: 'A', u: '/products/thermos-500?view=angle-a', w: 1 }]);
  // سنيبت القالب: يقرأ metafield المتجر وكود JavaScript صالح
  const snippet = splits.snippetLiquid();
  assert.match(snippet, /shop\.metafields\.erp_toureche\.splits\.value/);
  const js = snippet.slice(snippet.indexOf('<script>') + 8, snippet.indexOf('</script>')).replace('{{ erp_ab | json }}', JSON.stringify({ v: 1, b: null, tests: [] }));
  assert.doesNotThrow(() => new Function(js));
});

test('split: visit beacon is counted for humans and flagged for bots', () => {
  const t = splits.createTest(project.id, { name: 'Beacon', variants: [{ url: 'https://shop.example/a' }, { url: 'https://shop.example/b' }] });
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
});
