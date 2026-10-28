import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { every5min } from '../server/services/scheduler.js';
import * as fullsync from '../server/services/fullsync.js';

const project = createProject({ name: 'Sync Shop', domain: 'sync.example' });
const other = createProject({ name: 'Empty Shop', domain: 'empty.example' });

// Shopify وهمي: يعدّ الطلبات ويعيد قائمة طلبيات فارغة
let calls = 0;
globalThis.fetch = async (_url, init) => {
  calls++;
  const { query } = JSON.parse(init.body);
  const body = query.includes('orders(') ? { data: { orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } : { data: {} };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('full sync: nothing connected means nothing to run', async () => {
  const s = fullsync.start([other.id]);
  assert.deepEqual(s.steps, []);
  assert.equal((await fullsync.settle()).running, false);
});

test('scheduler: with automatic sync off (the default), nothing is pulled from Shopify in the background', async () => {
  setSetting('shopify_shop', 'sync-test', project.id);
  setSetting('shopify_access_token', 'shpat_test', project.id);
  calls = 0;
  await every5min();
  assert.equal(calls, 0);
  setSetting('auto_sync', true);
  await every5min();
  assert.ok(calls > 0, 'turned on: orders are pulled every 5 minutes again');
  setSetting('auto_sync', false);
});

test('full sync: one press runs every connected source in order, reports each step, and a second press joins the running one', async () => {
  const steps = Object.fromEntries(fullsync.STEPS.map((s) => [s.key, s.run]));
  let release;
  const gate = new Promise((r) => (release = r));
  const fake = {
    products: async () => ({ total: 3, created: 1, updated: 2 }),
    orders: async () => {
      await gate;
      return { fetched: 5, created: 2 };
    },
    pages: async () => {
      throw new Error('access_denied read_online_store_pages');
    },
    returns: async () => ({ tried: 0 }),
  };
  for (const s of fullsync.STEPS) if (fake[s.key]) s.run = fake[s.key];
  try {
    const s = fullsync.start([project.id, other.id], { userId: 1 });
    assert.deepEqual(
      s.steps.map((x) => x.key),
      ['products', 'orders', 'pages', 'returns'],
      'products before orders; carriers, Meta and Sheets are not connected so they are not listed',
    );
    assert.equal(fullsync.start([project.id]).already, true);
    release();
    const done = await fullsync.settle();
    assert.deepEqual(
      done.steps.map((x) => [x.key, x.status]),
      [
        ['products', 'ok'],
        ['orders', 'ok'],
        ['pages', 'error'],
        ['returns', 'ok'],
      ],
    );
    assert.equal(done.steps[1].result.created, 2);
    assert.match(done.steps[2].error, /read_online_store_pages/);
    assert.ok(done.steps.every((x) => typeof x.ms === 'number'));
    assert.ok(done.finished_at);
    assert.equal(fullsync.status().running, false);
  } finally {
    for (const s of fullsync.STEPS) s.run = steps[s.key];
  }
});
