import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { recordVisit } from '../server/services/tracking.js';
import { brokenLinks, fixLink } from '../server/services/links.js';

const p = createProject({ name: 'Links shop', domain: 'links.example' });
setSetting('shopify_shop', 'links-test', p.id);
setSetting('shopify_access_token', 'shpat_test', p.id);
const THERMOS = 'thermos-enfant-mickey-minnie-320ml-bandouliere';
const BAG = 'ensemble-sac-chaussures-femme-cuir-37-40';
const product = db.prepare("INSERT INTO products (project_id, title, handle, shopify_id, shopify_status, price) VALUES (?, ?, ?, ?, 'ACTIVE', 2400)");
product.run(p.id, 'ترمس أطفال ميكي وميني 320 مل ستانلس ستيل بحزام كتف', THERMOS, 'gid://shopify/Product/1');
product.run(p.id, 'طقم حقيبة وحذاء نسائي من الجلد', BAG, 'gid://shopify/Product/2');

// Shopify وهمي: قائمة التحويلات، البحث بالمسار، الإنشاء
const redirects = [
  { id: 'gid://shopify/UrlRedirect/1', path: '/products/thermos-disney-mickey-and-minnie', target: '/products/thermos-disney-mickey-minnie' },
  { id: 'gid://shopify/UrlRedirect/2', path: '/pages/page-faq', target: '/pages/faq' },
];
const created = [];
globalThis.fetch = async (url, init = {}) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!String(url).includes('links-test.myshopify.com')) throw new Error(`unexpected ${url}`);
  const { query, variables } = JSON.parse(init.body);
  if (query.includes('urlRedirectCreate')) {
    const r = { id: `gid://shopify/UrlRedirect/${10 + created.length}`, ...variables.r };
    created.push(r);
    return json({ data: { urlRedirectCreate: { urlRedirect: r, userErrors: [] } } });
  }
  if (query.includes('urlRedirectUpdate')) return json({ data: { urlRedirectUpdate: { urlRedirect: { id: variables.id, ...variables.r }, userErrors: [] } } });
  if (query.includes('urlRedirects')) return json({ data: { urlRedirects: { nodes: redirects } } });
  throw new Error(`unexpected query ${query.slice(0, 80)}`);
};

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const visit = (u, vid, t = '404') => recordVisit(p.slug, { e: 'v', u, vid, t }, UA);
const ARABIC_OLD = '/products/ترموس-ديزني-ميكي-وميني-320-مل-ستانلس-ستيل';

test('broken links: 404 pages people really opened, with the closest live page suggested', async () => {
  for (const vid of ['a1a1a1a1a1a1a1a1', 'b2b2b2b2b2b2b2b2', 'c3c3c3c3c3c3c3c3']) visit('https://links.example/products/thermos-disney-mickey-minnie-320ml?fbclid=x', vid);
  visit(`https://links.example${encodeURI(ARABIC_OLD)}`, 'd4d4d4d4d4d4d4d4');
  visit('https://links.example/en/products/sac', 'e5e5e5e5e5e5e5e5');
  visit('https://links.example/products/robe', 'f6f6f6f6f6f6f6f6');
  visit(`https://links.example/products/${THERMOS}`, 'a1a1a1a1a1a1a1a1', 'product'); // صفحة حية: لا تظهر
  assert.equal(db.prepare("SELECT page_type FROM page_visits WHERE page = '/products/robe'").get().page_type, '404', 'the 404 page type is kept (it has digits)');

  const r = await brokenLinks(p.id);
  const by = Object.fromEntries(r.hits.map((h) => [h.page, h]));
  assert.equal(r.hits[0].page, '/products/thermos-disney-mickey-minnie-320ml', 'most visitors first');
  assert.equal(by['/products/thermos-disney-mickey-minnie-320ml'].visitors, 3);
  assert.equal(by['/products/thermos-disney-mickey-minnie-320ml'].suggestion, `/products/${THERMOS}`);
  assert.equal(by[ARABIC_OLD].suggestion, `/products/${THERMOS}`, 'Arabic words match the Arabic title');
  assert.equal(by['/products/sac'].suggestion, `/products/${BAG}`, 'the language folder is ignored');
  assert.equal(by['/products/robe'].suggestion, '/', 'nothing close: the home page');
  assert.equal(by[`/products/${THERMOS}`], undefined);
  // تحويل قديم يشير إلى منتج لم يعد موجوداً
  assert.deepEqual(
    r.dead.map((d) => [d.path, d.target, d.suggestion]),
    [['/products/thermos-disney-mickey-and-minnie', '/products/thermos-disney-mickey-minnie', `/products/${THERMOS}`]],
  );
  assert.ok(r.targets.some((t) => t.kind === 'product' && t.target === `/products/${BAG}`));
});

test('broken links: one 301 per link (Shopify applies it to every language folder), Arabic paths encoded', async () => {
  const r = await fixLink(p.id, { path: ARABIC_OLD, target: `/products/${THERMOS}` });
  assert.equal(created.length, 1);
  assert.equal(created[0].path, encodeURI(ARABIC_OLD));
  assert.equal(created[0].target, `/products/${THERMOS}`);
  assert.equal(r.target, `/products/${THERMOS}`);
  await assert.rejects(fixLink(p.id, { path: '/', target: '/products/x' }), /path_invalid/);
  await assert.rejects(fixLink(p.id, { path: '/products/a', target: 'https://evil.example' }), /target_invalid/);
  await assert.rejects(fixLink(p.id, { path: '/products/a', target: '/products/a' }), /target_same_as_path/);
});
