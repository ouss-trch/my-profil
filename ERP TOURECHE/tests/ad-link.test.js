import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { checkAdLink, cleanAdLink, pixelIdsIn } from '../server/services/links.js';
import { AD_URL_TAGS } from '../server/services/ads.js';
import { createCreative } from '../server/integrations/meta.js';

const p = createProject({ name: 'Ad link shop', domain: 'shop.example' });
setSetting('store_domain', 'shop.example', p.id);
setSetting('meta_pixel_id', '2111277745999858', p.id);

// صفحات المتجر كما يراها زائر الإعلان
const page = (canonical, { pixel = '2111277745999858', form = true, soldOut = false } = {}) =>
  `<html><head><link rel="canonical" href="https://shop.example${canonical}">${soldOut ? '<meta property="product:availability" content="out of stock">' : ''}<script>window.riwaq = { pixelId: "${pixel}" };</script></head><body>${form ? '<form data-lead-form></form>' : ''}</body></html>`;
const PAGES = {
  'https://shop.example/products/thermos': [200, page('/products/thermos')],
  'https://shop.example/products/thermos?view=lp-thermos-cadeau': [200, page('/products/thermos')],
  'https://shop.example/products/old-thermos': [301, null, '/products/thermos'],
  'https://shop.example/products/gone': [404, '<h1>404</h1>'],
  'https://shop.example/products/empty': [200, page('/products/empty', { soldOut: true })],
  'https://shop.example/products/no-pixel': [200, page('/products/no-pixel', { pixel: '', form: false }).replace('pixelId: ""', '')],
  'https://shop.example/products/other-pixel': [200, page('/products/other-pixel', { pixel: '999999999' })],
  'https://shop.example/products/moved-canonical': [200, page('/products/thermos')],
  'https://shop.example/products/loop': [302, null, '/products/loop'],
  'https://shop.example/products/unsafe': [302, null, 'http://127.0.0.1/admin'],
  'https://go.example/r/thermos': [302, null, 'https://shop.example/products/thermos'],
};
const graphCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://graph.facebook.com/')) {
    graphCalls.push({ url: u, body: Object.fromEntries(new URLSearchParams(init.body || '')) });
    return new Response(JSON.stringify({ id: 'cr_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  assert.equal(init.redirect, 'manual', 'redirects are followed one by one');
  const [status, body, location] = PAGES[u] || PAGES[u.split('?')[0]] || [404, ''];
  return new Response(body, { status, headers: location ? { location } : {} });
};

test('ad link: the product page opens with the store pixel and the order form', async () => {
  const r = await checkAdLink(p.id, 'https://shop.example/products/thermos');
  assert.equal(r.ok, true);
  assert.deepEqual([r.status, r.final_url, r.pixels, r.has_form], [200, 'https://shop.example/products/thermos', ['2111277745999858'], true]);
  assert.deepEqual(r.problems, []);
  // صفحة هبوط ‎?view=lp-…‎: الرابط الأساسي صفحة المنتج نفسها (نفس المسار) فلا تنبيه
  assert.deepEqual((await checkAdLink(p.id, 'https://shop.example/products/thermos?view=lp-thermos-cadeau')).problems, []);
});

test('ad link: a 404, a sold-out product, a redirect loop or an unsafe redirect block the launch; a redirect only warns', async () => {
  const codes = async (url) => (await checkAdLink(p.id, url)).problems.map((x) => x.code);
  assert.deepEqual(await codes('https://shop.example/products/gone'), ['not_found']);
  assert.equal((await checkAdLink(p.id, 'https://shop.example/products/gone')).ok, false);
  assert.deepEqual(await codes('https://shop.example/products/empty'), ['sold_out']);
  assert.deepEqual(await codes('https://shop.example/products/loop'), ['redirect_loop', 'redirect']);
  assert.deepEqual(await codes('https://shop.example/products/unsafe'), ['redirect_unsafe', 'redirect']);
  // تحويل داخل المتجر: الإطلاق ممكن، والرابط النهائي يُقترح
  const moved = await checkAdLink(p.id, 'https://shop.example/products/old-thermos?utm_source=fb');
  assert.equal(moved.ok, true);
  assert.equal(moved.final_url, 'https://shop.example/products/thermos');
  assert.deepEqual(moved.problems.map((x) => x.code), ['redirect', 'params_in_link']);
  // صفحة رابطها الأساسي صفحة أخرى (منتج قديم يعرض محتوى آخر): تنبيه
  assert.deepEqual(await codes('https://shop.example/products/moved-canonical'), ['canonical_mismatch']);
  // نطاق آخر قبل المتجر (رابط تحويل خارجي)
  assert.deepEqual(await codes('https://go.example/r/thermos'), ['redirect_other_domain']);
});

test('ad link: the pixel on the page must be the campaign pixel; the order form must be there', async () => {
  const none = await checkAdLink(p.id, 'https://shop.example/products/no-pixel');
  assert.deepEqual(none.problems.map((x) => x.code), ['pixel_missing', 'form_missing']);
  assert.equal(none.ok, true, 'warnings, not blockers');
  const other = await checkAdLink(p.id, 'https://shop.example/products/other-pixel');
  assert.deepEqual(other.problems, [{ code: 'pixel_mismatch', level: 'high', params: { expected: '2111277745999858', found: '999999999' } }]);
  // البيكسل المختار في الحملة يُقارن بدل بيكسل المشروع
  assert.deepEqual((await checkAdLink(p.id, 'https://shop.example/products/other-pixel', { pixelId: '999999999' })).problems, []);
  assert.deepEqual(pixelIdsIn(`<img src="https://www.facebook.com/tr?id=123456789&ev=PageView"> fbq('init', '987654321')`).sort(), ['123456789', '987654321']);
});

test('ad link: only public https addresses are opened (never the ERP’s own network)', async () => {
  for (const bad of ['http://shop.example/products/thermos', 'https://127.0.0.1/admin', 'https://localhost/x', 'https://n8n:5678/webhook', 'https://shop.example:8443/x', 'nonsense'])
    await assert.rejects(checkAdLink(p.id, bad), (e) => e.code === 'link_invalid', bad);
});

test('ad link: tracking parameters leave the link and go to Meta’s URL parameters, filled per click', async () => {
  assert.equal(cleanAdLink('https://shop.example/products/thermos?utm_source=fb&utm_campaign=p1&fbclid=abc&variant=42'), 'https://shop.example/products/thermos?variant=42');
  assert.match(AD_URL_TAGS, /utm_source=\{\{site_source_name\}\}/);
  assert.match(AD_URL_TAGS, /utm_campaign=\{\{campaign\.id\}\}&utm_term=\{\{adset\.id\}\}&utm_content=\{\{ad\.id\}\}/);
  await createCreative({ meta_access_token: 'EAAtest', meta_graph_version: 'v25.0' }, '123', { name: 'T', pageId: '9', link: 'https://shop.example/products/thermos', message: 'm', headline: 'h', imageHash: 'abc', urlTags: AD_URL_TAGS });
  const body = graphCalls.at(-1).body;
  assert.equal(body.url_tags, AD_URL_TAGS);
  assert.equal(JSON.parse(body.object_story_spec).link_data.link, 'https://shop.example/products/thermos');
});
