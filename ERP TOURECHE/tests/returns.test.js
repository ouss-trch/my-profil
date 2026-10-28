import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { dzDay } from '../server/lib/util.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { changeStatus, createOrder, getOrder, upsertFromShopify } from '../server/services/orders.js';
import { drain } from '../server/services/effects.js';
import { stats } from '../server/services/analytics.js';
import { breakEven, productTest } from '../server/services/ads.js';
import * as returns from '../server/services/returns.js';
import * as advisor from '../server/services/advisor.js';

const project = createProject({ name: 'Returns Shop', domain: 'returns.example' });
setSetting('shopify_shop', 'returns-test', project.id);
setSetting('shopify_access_token', 'shpat_test', project.id);
db.prepare("INSERT OR REPLACE INTO carrier_tariffs (project_id, carrier, wilaya_code, home_fee, desk_fee, return_fee) VALUES (?, 'yalidine', 16, 500, 350, 250)").run(project.id);
const VARIANT = 'gid://shopify/ProductVariant/111';
const product = createProduct(project.id, { title: 'Thermos', price: 2900, cost_price: 1000, packaging_cost: 50, stock: 10, shopify_id: 'gid://shopify/Product/11' });
const stock = () => db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock;

// Shopify وهمي: يسجّل التعديلات ويعيد الإجابات كما يعيدها Admin GraphQL
const calls = [];
let failNext = null;
let tracked = true;
globalThis.fetch = async (url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (query.includes('fulfillmentOrders')) return reply({ errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] });
  if (query.includes('location { id }'))
    return reply({ data: { location: { id: 'gid://shopify/Location/1' }, nodes: variables.ids.map((id) => ({ id, inventoryItem: { id: `gid://shopify/InventoryItem/${id.split('/').pop()}`, tracked } })) } });
  if (query.includes('inventoryAdjustQuantities')) {
    calls.push({ query, ...variables });
    if (failNext) {
      const message = failNext;
      failNext = null;
      return reply({ data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ['input'], message }] } } });
    }
    return reply({ data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/1' }, userErrors: [] } } });
  }
  // وسوم erp-returned وما شابه: غير معنية بهذا الاختبار
  if (/tagsAdd|tagsRemove|orderMarkAsPaid/.test(query)) return reply({ data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] }, orderMarkAsPaid: { userErrors: [] } } });
  throw new Error(`unexpected request ${url}`);
};

let n = 1000;
const shopifyOrder = (qty = 2) => {
  const { id } = upsertFromShopify(project.id, {
    external_id: `gid://shopify/Order/${++n}`,
    shopify_name: `#${n}`,
    customer_name: 'Z',
    phone: '0550000000',
    wilaya_code: 16,
    items: [{ shopify_product_id: 'gid://shopify/Product/11', variant_id: VARIANT, title: 'Thermos', qty, price: 2900 }],
    subtotal: 2900 * qty,
    discount: 0,
    shipping_fee: 0,
    total: 2900 * qty,
  });
  db.prepare("UPDATE orders SET carrier = 'yalidine', tracking = ?, status = 'returning' WHERE id = ?").run(`YAL-${n}`, id);
  return id;
};

test('returns: a Shopify parcel back with the seller goes back to stock in Shopify and in the ERP', async () => {
  const id = shopifyOrder(2);
  changeStatus(id, 'returned', { force: true, source: 'carrier' });
  assert.equal(stock(), 12, 'ERP copy moves at once');
  await drain();
  const r = getOrder(id).return;
  assert.equal(r.shopify_state, 'done');
  assert.deepEqual(r.shopify_applied, { [VARIANT]: 2 });
  const c = calls.at(-1);
  assert.match(c.query, /@idempotent\(key: \$key\)/);
  assert.match(c.key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(c.input, {
    name: 'available',
    reason: 'restock',
    referenceDocumentUri: `gid://shopify/Order/${n}`,
    changes: [{ inventoryItemId: 'gid://shopify/InventoryItem/111', locationId: 'gid://shopify/Location/1', delta: 2, changeFromQuantity: null }],
  });
  // نفس الحالة مرة ثانية من شركة التوصيل: لا شيء يتكرر
  changeStatus(id, 'returned', { force: true, source: 'carrier' });
  await drain();
  assert.equal(stock(), 12);
  assert.equal(calls.length, 1);
});

test('returns: a damaged unit leaves stock and counts as lost goods at cost price', async () => {
  const id = db.prepare("SELECT id FROM orders WHERE status = 'returned' ORDER BY id LIMIT 1").get().id;
  const r = getOrder(id).return;
  assert.throws(() => returns.updateReturn(r.id, { items: [{ idx: 0, back: 1 }] }), /return_loss_required/);
  assert.throws(() => returns.updateReturn(r.id, { items: [{ idx: 0, back: 3, loss: 'damaged' }] }), /return_qty_invalid/);
  returns.updateReturn(r.id, { items: [{ idx: 0, back: 1, loss: 'damaged' }] });
  await drain();
  assert.equal(stock(), 11);
  const c = calls.at(-1);
  assert.equal(c.input.reason, 'damaged');
  assert.equal(c.input.changes[0].delta, -1);
  const after = getOrder(id).return;
  assert.equal(after.goods_lost, 1000);
  assert.equal(after.packaging_lost, 50);
  const f = stats([project.id], dzDay(), dzDay()).finance;
  assert.equal(f.return_cost, 250 + 50 + 1000);
  assert.equal(f.return_goods_lost, 1000);
});

test('returns: a status corrected to delivered takes the restocked units back out', async () => {
  const id = db.prepare("SELECT id FROM orders WHERE status = 'returned' ORDER BY id LIMIT 1").get().id;
  changeStatus(id, 'delivered', { force: true, source: 'manual' });
  await drain();
  assert.equal(stock(), 10);
  const r = getOrder(id).return;
  assert.equal(r.state, 'reversed');
  assert.deepEqual(r.shopify_applied, { [VARIANT]: 0 });
  assert.equal(calls.at(-1).input.reason, 'correction');
  assert.equal(stats([project.id], dzDay(), dzDay()).finance.return_cost, 0);
});

test('returns: an order Shopify never deducted changes no stock, but its return still costs', async () => {
  const before = calls.length;
  const o = createOrder(project.id, { customer_name: 'S', phone: '0550000001', wilaya_code: 16, items: [{ title: 'Thermos', product_id: product.id, qty: 1, price: 2900 }] });
  db.prepare("UPDATE orders SET carrier = 'yalidine', tracking = 'YAL-S1', status = 'returning' WHERE id = ?").run(o.id);
  changeStatus(o.id, 'returned', { force: true });
  await drain();
  const r = getOrder(o.id).return;
  assert.equal(r.items[0].why, 'not_deducted');
  assert.equal(r.shopify_state, 'skipped');
  assert.equal(stock(), 10);
  assert.equal(calls.length, before);
  assert.equal(returns.returnCost(getOrder(o.id), returns.returnOf(o.id)).total, 250 + 50);
});

test('returns: a failed Shopify call is retried with the same idempotency key, then the Advisor alert clears', async () => {
  failNext = 'Access denied for inventoryAdjustQuantities';
  const id = shopifyOrder(1);
  changeStatus(id, 'returned', { force: true });
  await drain();
  let r = getOrder(id).return;
  assert.equal(r.shopify_state, 'failed');
  assert.match(r.shopify_error, /Access denied/);
  assert.equal(stock(), 11, 'the ERP copy is already right');
  const alert = advisor.analyze([project.id]).insights.find((i) => i.key === `stock.returns_shopify:${project.id}`);
  assert.equal(alert?.severity, 'high');
  const firstKey = calls.at(-1).key;
  r = await returns.retryNow(r.id);
  assert.equal(r.shopify_state, 'done');
  assert.equal(calls.at(-1).key, firstKey, 'same transition, same key: Shopify cannot apply it twice');
  assert.equal(advisor.analyze([project.id]).insights.find((i) => i.key === `stock.returns_shopify:${project.id}`), undefined);
});

test('returns: untracked inventory in Shopify is left alone', async () => {
  tracked = false;
  const before = calls.length;
  const id = shopifyOrder(1);
  changeStatus(id, 'returned', { force: true });
  await drain();
  const r = getOrder(id).return;
  assert.equal(r.shopify_state, 'done');
  assert.equal(r.items[0].why, 'untracked');
  assert.equal(calls.length, before);
  tracked = true;
});

test('returns: returns from before the ledger are listed, then restocked now or recorded as already restocked', async () => {
  const a = shopifyOrder(1);
  const b = shopifyOrder(3);
  db.prepare("UPDATE orders SET status = 'returned', returned_at = ?, closed_at = ? WHERE id IN (?, ?)").run(new Date().toISOString(), new Date().toISOString(), a, b);
  const legacy = returns.legacyReturns([project.id]).map((x) => x.id);
  assert.deepEqual(legacy.sort(), [a, b].sort());
  assert.equal(advisor.analyze([project.id]).insights.find((i) => i.key === `stock.returns_legacy:${project.id}`)?.severity, 'medium');
  const s0 = stock();
  const c0 = calls.length;
  returns.processLegacy([project.id], [a], { alreadyRestocked: true });
  await drain();
  assert.equal(stock(), s0, 'already restocked by hand: nothing moves');
  assert.equal(calls.length, c0);
  assert.equal(returns.returnOf(a).shopify_state, 'done');
  returns.processLegacy([project.id], [b], { alreadyRestocked: false });
  await drain();
  assert.equal(stock(), s0 + 3);
  assert.equal(calls.at(-1).input.changes[0].delta, 3);
  assert.equal(returns.summary([project.id]).legacy, 0);
  // تصحيح لاحق على مرتجعة «أُعيدت يدوياً» يبدأ من الرقم الصحيح
  returns.updateReturn(returns.returnOf(a).id, { items: [{ idx: 0, back: 0, loss: 'missing' }] });
  await drain();
  assert.equal(stock(), s0 + 3 - 1);
  assert.equal(calls.at(-1).input.reason, 'shrinkage');
});

test('returns: break-even for Meta carries the real cost of each return', () => {
  const be = breakEven(product, project.id);
  assert.equal(be.return_cost, 250 + 50 + (be.loss_rate / 100) * 1000);
  const t = productTest(project.id, product, 7);
  assert.ok(t.returned >= 1);
  assert.ok(t.return_cost_da >= 250 + 50);
  assert.equal(typeof t.return_rate, 'number');
});
