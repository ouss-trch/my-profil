import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { campaignErpStats } from '../server/services/ads.js';

const p = createProject({ name: 'CPA shop', domain: 'cpa.example' });
const product = createProduct(p.id, { title: 'Thermos', handle: 'thermos', price: 5900, cost_price: 2000, packaging_cost: 100 });
let n = 0;
const order = (campaign, status) => {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO orders (project_id, ref, customer_name, phone, status, total, created_at, updated_at, items, utm_campaign) VALUES (?, ?, 'x', '0550000000', ?, 6300, ?, ?, '[]', ?)").run(p.id, `CP-${++n}`, status, now, now, campaign);
};
const since = new Date(Date.now() - 7 * 864e5).toISOString();

test('campaign delivered cost: orders are matched to the campaign by its id, and the verdict compares the cost per delivered order with the break-even', () => {
  // حملة A: 4 مسلّمة + 2 في الطريق + 1 مرتجعة + 1 ملغاة + 1 متروكة (لا تُعدّ)
  for (const s of ['delivered', 'delivered', 'delivered', 'delivered', 'shipped', 'confirmed', 'returned', 'cancelled', 'abandoned']) order('111', s);
  // حملة B: طلبية واحدة جديدة فقط. حملة أخرى لا تدخل في A
  order('222', 'new');
  order('999', 'delivered');
  const stats = campaignErpStats(p.id, since, [
    { id: '111', spend_da: 3000, product_id: product.id },
    { id: '222', spend_da: 500, product_id: product.id },
    { id: '333', spend_da: 800, product_id: null },
  ]);
  const a = stats.get('111');
  assert.deepEqual([a.erp_orders, a.erp_delivered, a.erp_in_flight, a.erp_returned], [8, 4, 2, 1], 'abandoned forms are not orders');
  // المتوقع = 4 مسلّمة + 2 × نسبة التسليم (0.75 افتراضياً دون بيانات كافية) = 5.5 ؛ التكلفة = 3000 ÷ 5.5
  assert.equal(a.erp_expected_delivered, 5.5);
  assert.equal(a.cost_per_delivered_da, Math.round(3000 / 5.5));
  assert.ok(a.break_even_da > 0, 'the linked product gives the break-even');
  assert.ok(['winning', 'thin', 'losing'].includes(a.erp_verdict), 'enough delivered orders: a verdict, not a guess');
  const b = stats.get('222');
  assert.deepEqual([b.erp_orders, b.erp_delivered, b.cost_per_delivered_da, b.erp_verdict], [1, 0, null, 'insufficient'], 'one new order proves nothing');
  const c = stats.get('333');
  assert.deepEqual([c.erp_orders, c.cost_per_delivered_da, c.break_even_da, c.erp_verdict], [0, null, null, 'insufficient'], 'no orders, no product: no verdict');
  assert.equal(stats.has('999'), false, 'a campaign the ERP did not ask about is not invented');
  assert.equal(campaignErpStats(p.id, since, []).size, 0);
});

test('campaign delivered cost: a cheap-enough campaign wins, an expensive one loses', () => {
  for (let i = 0; i < 5; i++) order('444', 'delivered');
  const be = campaignErpStats(p.id, since, [{ id: '444', spend_da: 1, product_id: product.id }]).get('444').break_even_da;
  const win = campaignErpStats(p.id, since, [{ id: '444', spend_da: Math.floor(be * 0.4 * 5), product_id: product.id }]).get('444');
  const lose = campaignErpStats(p.id, since, [{ id: '444', spend_da: Math.ceil(be * 2 * 5), product_id: product.id }]).get('444');
  assert.equal(win.erp_verdict, 'winning');
  assert.equal(lose.erp_verdict, 'losing');
});
