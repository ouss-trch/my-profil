import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { dzDay } from '../server/lib/util.js';
import { createProject } from '../server/services/projects.js';
import { createOrder, changeStatus } from '../server/services/orders.js';
import { stats } from '../server/services/analytics.js';
import { orderChannel } from '../server/services/tracking.js';

const p = createProject({ name: 'Sources shop', domain: 'sources.example' });
const today = dzDay();
const now = new Date().toISOString();
const visit = db.prepare('INSERT INTO page_visits (project_id, day, page, visitor, views, first_at, last_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
const visitors = (page, n) => {
  for (let i = 0; i < n; i++) visit.run(p.id, today, page, `${page}#${i}`, now, now);
};
visitors('/products/gift?view=lp-gift-hadiya', 10);
visitors('/products/gift', 5);
visitors('/collections/all', 6);
visitors('/pages/contact', 2); // قليل: لا يظهر دون طلبيات

let n = 0;
function order(extra, end, source = 'shopify') {
  const { id } = createOrder(p.id, { ref: `S-${++n}`, phone: `055010000${n}`, wilaya: 16, items: [{ title: 'Gift', qty: 1, price: 3000 }], total: 3000, ...extra }, { source });
  if (end) changeStatus(id, end, { force: true });
  return id;
}
const LP = 'https://sources.example/products/gift?view=lp-gift-hadiya&fbclid=AbC123';
order({ landing_url: LP }, 'delivered');
order({ landing_url: LP }, 'returned');
order({ landing_url: LP }, 'fake'); // لا تُحسب
order({ landing_url: 'https://sources.example/fr/products/gift?utm_source=google' }, 'confirmed');
order({}, null, 'manual');
order({}, null, 'sheet');

test('dashboard sources: orders per page with the visitors of the same period, and per channel (not «shopify»)', () => {
  const d = stats([p.id], today, today);
  const by = Object.fromEntries(d.source_pages.map((x) => [x.key ?? 'none', x]));
  const lp = by['/products/gift?view=lp-gift-hadiya'];
  assert.deepEqual([lp.kind, lp.visitors, lp.orders, lp.conversion, lp.delivered, lp.returned, lp.delivery_rate, lp.revenue], ['template', 10, 2, 20, 1, 1, 50, 3000]);
  const product = by['/products/gift'];
  assert.deepEqual([product.kind, product.visitors, product.orders, product.confirmed], ['product', 5, 1, 1]);
  assert.deepEqual([by['/collections/all'].visitors, by['/collections/all'].orders], [6, 0], 'visited by many, no order: shown');
  assert.equal(by['/pages/contact'], undefined);
  assert.deepEqual([by.none.kind, by.none.orders, by.none.visitors], ['none', 2, 0]);
  assert.equal(d.source_pages[0].key, '/products/gift?view=lp-gift-hadiya', 'most orders first');
  const ch = Object.fromEntries(d.sources.map((x) => [x.source, x.orders]));
  assert.deepEqual(ch, { meta: 2, google: 1, manual: 1, unknown: 1 });
  assert.equal(d.sources.find((x) => x.source === 'meta').delivery_rate, 50);
});

test('order channel: the landing link decides, the saved utm_source fills the gap', () => {
  assert.equal(orderChannel({ source: 'shopify', landing_url: 'https://s.example/p?ttclid=1' }), 'tiktok');
  assert.equal(orderChannel({ source: 'shopify', landing_url: 'https://s.example/p', utm_source: 'ig' }), 'meta');
  assert.equal(orderChannel({ source: 'shopify', landing_url: 'https://s.example/p' }), 'direct');
  assert.equal(orderChannel({ source: 'sheet', landing_url: null, utm_source: 'facebook' }), 'meta');
  assert.equal(orderChannel({ source: 'api', landing_url: null }), 'unknown');
  assert.equal(orderChannel({ source: 'manual', landing_url: null }), 'manual');
  assert.equal(orderChannel({ source: 'manual', landing_url: 'https://s.example/p?fbclid=1' }), 'meta', 'the link wins');
});
