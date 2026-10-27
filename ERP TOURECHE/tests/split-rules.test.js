import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createOrder } from '../server/services/orders.js';
import { attributionHealth } from '../server/services/pages.js';
import { parseOrder } from '../server/integrations/shopify.js';
import * as splits from '../server/services/splits.js';

const project = createProject({ name: 'Split rules', domain: 'rules.example' });

test('split rules: a broken traffic split withholds the verdict', () => {
  // أوزان 1:1 لكن 1000 زائر مقابل 1300: أكثر مما تفسّره الصدفة
  assert.equal(splits.splitIsBroken([{ visitors: 1000, weight: 1 }, { visitors: 1300, weight: 1 }]), true);
  assert.equal(splits.splitIsBroken([{ visitors: 1000, weight: 1 }, { visitors: 1040, weight: 1 }]), false);
  assert.equal(splits.splitIsBroken([{ visitors: 750, weight: 3 }, { visitors: 250, weight: 1 }]), false);

  const t = splits.createTest(project.id, { name: 'SRM', variants: [{ url: 'https://rules.example/products/x' }, { url: 'https://rules.example/products/x?view=landing' }] });
  splits.updateTest(t.id, { status: 'running' });
  const stmt = db.prepare('INSERT INTO split_clicks (test_id, variant_id, visitor, at) VALUES (?, ?, ?, ?)');
  t.variants.forEach((v, k) => {
    for (let i = 0; i < (k ? 1300 : 1000); i++) stmt.run(t.id, v.id, `${v.label}${String(i).padStart(15, '0')}`, new Date().toISOString());
  });
  assert.equal(splits.results(t.id).verdict, 'split_broken');
});

test('split rules: one running test per entry page', () => {
  const a = splits.createTest(project.id, { name: 'Gift angle', variants: [{ url: 'https://rules.example/products/y' }, { url: 'https://rules.example/products/y?view=gift' }] });
  const b = splits.createTest(project.id, { name: 'Price angle', variants: [{ url: 'https://rules.example/products/y' }, { url: 'https://rules.example/products/y?view=price' }] });
  splits.updateTest(a.id, { status: 'running' });
  assert.throws(() => splits.updateTest(b.id, { status: 'running' }), /split_entry_busy:Gift angle/);
  splits.updateTest(a.id, { status: 'paused' });
  assert.equal(splits.updateTest(b.id, { status: 'running' }).status, 'running');
});

test('orders: the page and A/B version come from the landing URL when the form sends only that', () => {
  const o = parseOrder({
    id: 'gid://shopify/Order/1',
    name: '#1040',
    customAttributes: [
      { key: 'ref', value: 'RW-X1' },
      { key: 'landing_page', value: 'https://souqnna.com/products/thermos?fbclid=abc&utm_source=meta&utm_campaign=c9&utm_content=thermos-lp-b&erp_v=thermos-lp.B&variant=1' },
    ],
    lineItems: { nodes: [] },
  });
  assert.equal(o.utm_content, 'thermos-lp-b');
  assert.equal(o.utm_campaign, 'c9');
  assert.equal(o.utm_source, 'meta');
  assert.match(o.landing_url, /erp_v=thermos-lp\.B/);
  // خاصية صريحة تبقى أولى من الرابط
  const p = parseOrder({ id: 'x', customAttributes: [{ key: 'utm_content', value: 'direct' }, { key: 'landing_page', value: '/products/a?utm_content=from-url' }], lineItems: { nodes: [] } });
  assert.equal(p.utm_content, 'direct');
});

test('attribution health: says when orders arrive without their page', () => {
  const p = createProject({ name: 'Attribution', domain: 'attr.example' });
  assert.deepEqual(attributionHealth([p.id]), { days: 14, orders: 0, with_page: 0, with_content: 0, ok: true });
  for (let i = 0; i < 4; i++) createOrder(p.id, { ref: `AT-${i}`, phone: '0550000009', wilaya: 16, items: [{ title: 'T', qty: 1, price: 1 }] });
  assert.equal(attributionHealth([p.id]).ok, false);
  for (let i = 0; i < 4; i++) createOrder(p.id, { ref: `AT-L${i}`, phone: '0550000009', wilaya: 16, items: [{ title: 'T', qty: 1, price: 1 }], landing_url: 'https://attr.example/products/t?utm_content=t-a', utm_content: 't-a' });
  assert.deepEqual(attributionHealth([p.id]), { days: 14, orders: 8, with_page: 4, with_content: 4, ok: true });
});
