import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createOrder, getOrder, upsertFromShopify } from '../server/services/orders.js';
import { orderNumber } from '../server/lib/util.js';
import { adminOrderUrl } from '../server/integrations/shopify.js';

const project = createProject({ name: 'Number Shop', domain: 'number.example' });
const parsed = (over = {}) => ({
  external_id: 'gid://shopify/Order/18968996315330',
  shopify_name: '#1037',
  customer_name: 'Amina',
  phone: '0550998877',
  wilaya_code: 19,
  items: [{ title: 'Thermos', qty: 1, price: 6000 }],
  subtotal: 6000,
  discount: 0,
  shipping_fee: 600,
  total: 6600,
  ...over,
});

test('order number: a Shopify order carries the Shopify number everywhere', () => {
  const { id } = upsertFromShopify(project.id, parsed());
  const o = getOrder(id);
  assert.equal(o.ref, '1037');
  assert.equal(o.number, '1037');
  // إعادة المزامنة لا تكرر الطلبية
  assert.equal(upsertFromShopify(project.id, parsed()).id, id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE project_id = ? AND external_id = ?').get(project.id, parsed().external_id).n, 1);
});

test('order number: an order first seen in the sheet keeps its link but uses the Shopify number', () => {
  const { id } = createOrder(project.id, { ref: 'S-778', customer_name: 'Karim', phone: '0661223344', wilaya_code: 16, items: [{ title: 'x', qty: 1, price: 1000 }] }, { source: 'sheet' });
  upsertFromShopify(project.id, parsed({ external_id: 'gid://shopify/Order/2', shopify_name: '#1038', ref: 'S-778' }));
  const o = getOrder(id);
  assert.equal(o.ref, 'S-778');
  assert.equal(o.number, '1038');
  assert.equal(orderNumber({ ref: 'D1-2-3' }), 'D1-2-3');
});

test('order number: link to the order in Shopify admin', () => {
  assert.equal(adminOrderUrl({ shopify_shop: 'abc-1.myshopify.com' }, 'gid://shopify/Order/123'), 'https://abc-1.myshopify.com/admin/orders/123');
  assert.equal(adminOrderUrl({ shopify_shop: 'souqnna.com' }, 'gid://shopify/Order/123'), null);
  assert.equal(adminOrderUrl({}, 'gid://shopify/Order/123'), null);
});
