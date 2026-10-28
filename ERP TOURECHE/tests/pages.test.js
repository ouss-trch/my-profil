import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { createOrder } from '../server/services/orders.js';
import * as splits from '../server/services/splits.js';
import * as pages from '../server/services/pages.js';

const project = createProject({ name: 'Pages Shop', domain: 'pages.example' });
const thermos = createProduct(project.id, { title: 'ترمس أطفال', price: 6000, stage: 'published' });
// منتج مزامَن من Shopify يحتفظ بمعرّفه العربي كما في المتجر الحقيقي
db.prepare('UPDATE products SET handle = ? WHERE id = ?').run('ترمس-اطفال', thermos.id);
const find = (pred) => pages.listPages([project.id]).find(pred);

test('pages: product pages come from the catalog; pasted links are pinned at once', async () => {
  const s = await pages.syncPages(project.id);
  assert.equal(s.synced, 1);
  const ids = pages.addPages(project.id, { urls: 'https://pages.example/pages/thermos-lp\n/products/ترمس-اطفال?view=angle-gift\nhttps://lp.other.example/offer' });
  assert.equal(ids.length, 3);
  const all = pages.listPages([project.id]);
  assert.equal(all.filter((p) => p.pinned).length, 3);
  assert.equal(find((p) => p.path === '/pages/thermos-lp').kind, 'page');
  const view = find((p) => p.url.includes('view=angle-gift'));
  assert.equal(view.kind, 'product');
  assert.equal(view.product_id, thermos.id);
  assert.equal(find((p) => p.url.startsWith('https://lp.other.example')).kind, 'url');
  assert.throws(() => pages.addPages(project.id, { urls: 'javascript:alert(1)' }), /url_invalid/);
});

test('pages: orders are attributed by landing page (locale prefix, encoding and ?view variants)', () => {
  const lp = encodeURI('https://pages.example/fr/products/ترمس-اطفال?view=angle-gift&fbclid=x');
  createOrder(project.id, { customer_name: 'A', phone: '0550111001', wilaya_code: 16, items: [{ title: 'x', qty: 1, price: 6000 }], landing_url: lp, status: 'delivered' });
  createOrder(project.id, { customer_name: 'B', phone: '0550111002', wilaya_code: 16, items: [{ title: 'x', qty: 1, price: 6000 }], landing_url: '/products/ترمس-اطفال', status: 'returned' });
  const base = find((p) => p.kind === 'product' && !p.url.includes('view='));
  const variant = find((p) => p.url.includes('view=angle-gift'));
  assert.equal(base.orders_30d, 2);
  assert.equal(base.delivery_rate, 50);
  assert.equal(variant.orders_30d, 1);
  assert.equal(variant.delivered_30d, 1);
});

test('pages: A/B tests show on the page they use; sync keeps pins and flags deleted pinned pages', async () => {
  splits.createTest(project.id, { name: 'Thermos angles', entry_path: '/products/ترمس-اطفال', variants: [{ url: 'https://pages.example/products/x?view=a' }, { url: 'https://pages.example/products/x?view=b' }] });
  const base = find((p) => p.kind === 'product' && !p.url.includes('view='));
  assert.deepEqual(base.tests.map((t) => t.name), ['Thermos angles']);
  pages.updatePage(base.id, { pinned: true, note: 'الصفحة الرئيسية للإعلان' });
  assert.throws(() => pages.deletePage(base.id), /page_synced_unpin_instead/);
  db.prepare("UPDATE products SET stage = 'archived' WHERE id = ?").run(thermos.id);
  const s = await pages.syncPages(project.id);
  assert.equal(s.gone, 1);
  const kept = pages.listPages([project.id]).find((p) => p.id === base.id);
  assert.equal(kept.gone, 1);
  assert.equal(kept.note, 'الصفحة الرئيسية للإعلان');
  pages.deletePage(kept.id);
  // الروابط المضافة يدوياً لا تتأثر بالمزامنة وتُحذف عند الطلب
  assert.equal(find((p) => p.path === '/pages/thermos-lp').gone, 0);
  for (const kind of ['url', 'page']) {
    const other = find((p) => p.kind === kind);
    pages.deletePage(other.id);
    assert.equal(find((p) => p.id === other.id), undefined);
  }
});

test('pages: without read_online_store_pages, product pages still sync and the Shopify info pages already listed are kept', async () => {
  const shop = createProject({ name: 'Scope Shop', domain: 'scope.example' });
  const p = createProduct(shop.id, { title: 'Lamp', price: 3000, stage: 'published' });
  db.prepare('UPDATE products SET handle = ? WHERE id = ?').run('lamp', p.id);
  const { setSetting } = await import('../server/lib/settings.js');
  setSetting('shopify_shop', 'scope-test', shop.id);
  setSetting('shopify_access_token', 'shpat_test', shop.id);
  let denied = false;
  const prev = globalThis.fetch;
  globalThis.fetch = async () => {
    const body = denied
      ? { errors: [{ message: 'Access denied for pages field. Required access: `read_online_store_pages` access scope.', extensions: { code: 'ACCESS_DENIED' } }] }
      : { data: { pages: { nodes: [{ id: 'gid://shopify/Page/1', title: 'FAQ', handle: 'faq', isPublished: true }], pageInfo: { hasNextPage: false } } } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal((await pages.syncPages(shop.id)).synced, 2);
    denied = true;
    const s = await pages.syncPages(shop.id);
    assert.equal(s.shopify_pages, 'access_denied');
    assert.equal(s.synced, 1, 'the product page');
    assert.equal(s.removed, 0);
    assert.deepEqual(pages.listPages([shop.id]).map((x) => x.path).sort(), ['/pages/faq', '/products/lamp']);
    // خطأ آخر (شبكة، رمز مرفوض) يبقى خطأ ظاهراً
    globalThis.fetch = async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
    await assert.rejects(pages.syncPages(shop.id), /shopify_auth_failed/);
  } finally {
    globalThis.fetch = prev;
  }
});
