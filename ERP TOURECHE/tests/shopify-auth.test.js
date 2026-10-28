import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shopify from '../server/integrations/shopify.js';

// Shopify وهمي: تبادل client_credentials ثم GraphQL بالرمز الناتج
let calls = [];
let exchange = { status: 200, body: { access_token: 'shpca_fresh', expires_in: 86399 } };
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), token: init.headers['X-Shopify-Access-Token'] || null });
  if (String(url).endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify(exchange.body), { status: exchange.status, headers: { 'content-type': 'application/json' } });
  const ok = init.headers['X-Shopify-Access-Token'] === 'shpca_fresh';
  return new Response(JSON.stringify(ok ? { data: { shop: { name: 'SOU9NA' } } } : { errors: '[API] Invalid API key or access token' }), { status: ok ? 200 : 401, headers: { 'content-type': 'application/json' } });
};
const cfg = (extra) => ({ projectId: 1, shopify_shop: '15iapk-7m.myshopify.com', shopify_api_version: '2026-07', ...extra });

test('shopify auth: with a Dev Dashboard app, Client ID + secret win over an old shpat_ token left in the form', async () => {
  calls = [];
  const shop = await shopify.shopInfo(cfg({ shopify_client_id: 'cid', shopify_client_secret: 'shpss_x', shopify_access_token: 'shpat_expired', projectId: 11 }));
  assert.equal(shop.name, 'SOU9NA');
  assert.match(calls[0].url, /oauth\/access_token$/);
  assert.equal(calls[1].token, 'shpca_fresh');
});

test('shopify auth: the old token alone still works as a fallback, and a rejected one says so', async () => {
  calls = [];
  await assert.rejects(shopify.shopInfo(cfg({ shopify_access_token: 'shpat_expired', projectId: 12 })), /shopify_auth_failed/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'shpat_expired');
});

test('shopify auth: a refused exchange explains why (wrong client, or app and store in different organizations)', async () => {
  exchange = { status: 400, body: { error: 'invalid_client', error_description: 'Client authentication failed' } };
  await assert.rejects(shopify.shopInfo(cfg({ shopify_client_id: 'cid', shopify_client_secret: 'bad', projectId: 13 })), /shopify_client_invalid/);
  exchange = { status: 400, body: { error: 'shop_not_permitted', error_description: 'Shop is not permitted' } };
  await assert.rejects(shopify.shopInfo(cfg({ shopify_client_id: 'cid', shopify_client_secret: 'x', projectId: 14 })), /shop_not_permitted/);
});

test('shopify orders: the first sync asks for the last 60 days with an absolute date (Shopify rejects "-60d")', async () => {
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { variables } = JSON.parse(init.body);
    seen.push(variables.q);
    return new Response(JSON.stringify({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await shopify.ordersUpdatedSince(cfg({ shopify_access_token: 'shpat_ok', projectId: 15 }), null);
    await shopify.ordersUpdatedSince(cfg({ shopify_access_token: 'shpat_ok', projectId: 15 }), '2026-10-20T10:00:00Z');
  } finally {
    globalThis.fetch = prev;
  }
  assert.match(seen[0], /^created_at:>'\d{4}-\d{2}-\d{2}T[\d:.]+Z'$/);
  assert.ok(Math.abs(Date.parse(seen[0].slice(13, -1)) - (Date.now() - 60 * 86400e3)) < 60e3);
  assert.equal(seen[1], "updated_at:>'2026-10-20T10:00:00Z'");
});

test('shopify auth: a permission granted after the token was issued is picked up at once (fresh token, one retry)', async () => {
  const tokens = [];
  const prev = globalThis.fetch;
  let issued = 0;
  globalThis.fetch = async (url, init) => {
    const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).endsWith('/admin/oauth/access_token')) return reply({ access_token: `shpca_${++issued}`, expires_in: 86399 });
    const token = init.headers['X-Shopify-Access-Token'];
    tokens.push(token);
    // الرمز الأول صدر قبل إضافة read_online_store_pages
    if (token === 'shpca_1') return reply({ errors: [{ message: 'Access denied for pages field. Required access: `read_online_store_pages` access scope.', extensions: { code: 'ACCESS_DENIED' } }] });
    if (init.body.includes('pages(')) return reply({ data: { pages: { nodes: [{ id: 'gid://shopify/Page/1', title: 'FAQ', handle: 'faq', isPublished: true }], pageInfo: { hasNextPage: false } } } });
    return reply({ errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] });
  };
  try {
    const c = cfg({ shopify_client_id: 'cid', shopify_client_secret: 'shpss_x', projectId: 16 });
    const pages = await shopify.listPages(c);
    assert.equal(pages[0].handle, 'faq');
    assert.deepEqual(tokens, ['shpca_1', 'shpca_2']);
    // صلاحية ناقصة فعلاً: محاولة واحدة فقط ثم رسالة واضحة، بلا حلقة
    tokens.length = 0;
    await assert.rejects(shopify.gql(c, 'query { shop { name } }'), /access_denied/);
    assert.deepEqual(tokens, ['shpca_2', 'shpca_3']);
  } finally {
    globalThis.fetch = prev;
  }
});
