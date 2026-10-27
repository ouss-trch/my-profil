import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct, getProduct, updateProduct, publishProduct, adjustStock, setVariantStock } from '../server/services/products.js';

// ——— Shopify وهمي يحفظ حالة المنتج: الصور، الخيارات، المتغيرات، المخزون، والنشر على قناة المتجر الإلكتروني ———
const calls = [];
let scopes = { publications: true };
let published = false;
let shop = null; // المنتج كما في Shopify
let nextId = 100;
const gid = (type) => `gid://shopify/${type}/${nextId++}`;
const node = () => ({
  id: shop.id,
  title: shop.title,
  handle: 'thermos',
  status: shop.status,
  productType: '',
  vendor: '',
  tags: [],
  descriptionHtml: '',
  onlineStoreUrl: published ? 'https://souqnna.example/products/thermos' : null,
  totalInventory: shop.variants.reduce((s, v) => s + v.qty, 0),
  seo: { title: '', description: '' },
  options: shop.options.length ? shop.options.map((o) => ({ name: o.name, values: o.values })) : [{ name: 'Title', values: ['Default Title'] }],
  collections: { nodes: [] },
  media: { nodes: shop.media.map((m) => ({ id: m.id, alt: m.alt || '', image: { url: m.url } })) },
  variants: {
    nodes: shop.variants.map((v) => ({ id: v.id, title: Object.values(v.options).join(' / ') || 'Default Title', sku: v.sku || '', price: String(v.price), compareAtPrice: null, inventoryQuantity: v.qty, selectedOptions: Object.entries(v.options).map(([name, value]) => ({ name, value })) })),
  },
});
const variantsFrom = (input) =>
  input.variants.map((v) => {
    const prev = v.id && shop?.variants.find((x) => x.id === v.id);
    return {
      id: v.id || gid('ProductVariant'),
      item: prev?.item || gid('InventoryItem'),
      tracked: prev ? prev.tracked : Boolean(v.inventoryItem?.tracked),
      options: Object.fromEntries(v.optionValues.filter((o) => o.optionName !== 'Title').map((o) => [o.optionName, o.name])),
      price: Number(v.price),
      sku: v.sku || '',
      qty: prev ? prev.qty : v.inventoryQuantities?.[0]?.quantity ?? 0,
    };
  });

globalThis.fetch = async (url, init = {}) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!String(url).includes('sync-test.myshopify.com')) throw new Error(`unexpected ${url}`);
  const { query, variables } = JSON.parse(init.body);
  const q = query.replace(/\s+/g, ' ');
  calls.push({ q, variables });
  if (q.includes('productSet')) {
    const input = variables.input;
    if (!input.id) shop = { id: gid('Product'), title: input.title, status: input.status, media: (input.files || []).map((f) => ({ id: gid('MediaImage'), url: f.originalSource, alt: f.alt })), options: [], variants: [] };
    shop.options = input.productOptions.filter((o) => o.name !== 'Title').map((o) => ({ name: o.name, values: o.values.map((x) => x.name) }));
    shop.variants = variantsFrom(input);
    return json({ data: { productSet: { product: node(), userErrors: [] } } });
  }
  if (q.includes('{ location { id } }')) return json({ data: { location: { id: 'gid://shopify/Location/1' } } });
  if (q.includes('product(id: $id) { publishedOnPublication')) return json({ data: { product: { publishedOnPublication: published } } });
  if (q.includes('publications(first')) {
    if (!scopes.publications) return json({ errors: [{ message: 'Access denied for publications field.', extensions: { code: 'ACCESS_DENIED' } }] });
    return json({ data: { publications: { nodes: [{ id: 'gid://shopify/Publication/9', supportsFuturePublishing: true, catalog: { title: 'Channel Catalog 9 for Online Store' } }] } } });
  }
  if (q.includes('publishablePublish')) {
    published = true;
    return json({ data: { publishablePublish: { userErrors: [] } } });
  }
  if (q.includes('query($id: ID!) { product(id: $id)')) return json({ data: { product: node() } });
  if (q.includes('productUpdate')) {
    for (const m of variables.media || []) shop.media.push({ id: gid('MediaImage'), url: m.originalSource, alt: m.alt });
    if (variables.product.status) shop.status = variables.product.status;
    return json({ data: { productUpdate: { product: node(), userErrors: [] } } });
  }
  if (q.includes('fileUpdate')) {
    for (const f of variables.files) if (f.referencesToRemove?.includes(shop.id)) shop.media = shop.media.filter((m) => m.id !== f.id);
    return json({ data: { fileUpdate: { userErrors: [] } } });
  }
  if (q.includes('productReorderMedia')) {
    const order = [...shop.media];
    for (const mv of variables.moves) {
      const i = order.findIndex((m) => m.id === mv.id);
      const [m] = order.splice(i, 1);
      order.splice(Number(mv.newPosition), 0, m);
    }
    shop.media = order;
    return json({ data: { productReorderMedia: { job: { id: 'gid://shopify/Job/1' }, mediaUserErrors: [] } } });
  }
  if (q.includes('productVariantsBulkUpdate')) {
    for (const v of variables.variants) shop.variants.find((x) => x.id === v.id).price = Number(v.price);
    return json({ data: { productVariantsBulkUpdate: { userErrors: [] } } });
  }
  if (q.includes('nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity')) {
    return json({ data: { location: { id: 'gid://shopify/Location/1' }, nodes: variables.ids.map((id) => shop.variants.find((v) => v.id === id)).map((v) => v && { id: v.id, inventoryQuantity: v.qty, inventoryItem: { id: v.item, tracked: v.tracked } }) } });
  }
  if (q.includes('inventoryAdjustQuantities')) {
    for (const c of variables.input.changes) shop.variants.find((v) => v.item === c.inventoryItemId).qty += c.delta;
    return json({ data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: 'g1' }, userErrors: [] } } });
  }
  if (q.includes('inventorySetQuantities')) {
    for (const x of variables.input.quantities) shop.variants.find((v) => v.item === x.inventoryItemId).qty = x.quantity;
    return json({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'g2' }, userErrors: [] } } });
  }
  if (q.includes('inventoryItemUpdate')) {
    shop.variants.find((v) => v.item === variables.id).tracked = variables.input.tracked;
    return json({ data: { inventoryItemUpdate: { userErrors: [] } } });
  }
  if (q.includes('fileUpdate(files: $files) { userErrors')) return json({ data: { fileUpdate: { userErrors: [] } } });
  throw new Error(`unexpected query ${q.slice(0, 80)}`);
};

const project = createProject({ name: 'Sync shop', domain: 'souqnna.example' });
setSetting('shopify_shop', 'sync-test.myshopify.com', project.id);
setSetting('shopify_access_token', 'shpat_test', project.id);
const sent = (word) => calls.filter((c) => c.q.includes(word));
let productId = null;

test('product sync: a new product with colours is created with each colour’s stock, tracked, and shown on the Online Store', async () => {
  const p = createProduct(project.id, {
    title: 'ترمس ميكي',
    price: 5900,
    images: [{ url: 'https://cdn.example/a.jpg', alt: 'a' }, { url: 'https://cdn.example/b.jpg', alt: 'b' }],
    options: [{ name: 'اللون', values: ['أزرق', 'وردي'] }],
    variants: [
      { options: { اللون: 'أزرق' }, price: 5900, stock: 12, sku: 'TH-B' },
      { options: { اللون: 'وردي' }, price: 5900, stock: 7, sku: 'TH-P' },
    ],
  });
  productId = p.id;
  const out = await publishProduct(p.id, { status: 'ACTIVE' });
  const set = sent('productSet').at(-1).variables.input;
  assert.deepEqual(set.productOptions, [{ name: 'اللون', values: [{ name: 'أزرق' }, { name: 'وردي' }] }]);
  assert.deepEqual(
    set.variants.map((v) => [v.optionValues[0].name, v.inventoryQuantities?.[0]?.quantity, v.inventoryItem?.tracked]),
    [
      ['أزرق', 12, true],
      ['وردي', 7, true],
    ],
  );
  assert.equal(sent('publishablePublish').length, 1, 'active product published on the Online Store channel');
  assert.deepEqual(out.warnings, []);
  assert.equal(out.online_url, 'https://souqnna.example/products/thermos');
  assert.equal(out.stock, 19);
  assert.equal(out.variants.length, 2);
  assert.ok(out.variants.every((v) => v.id));
});

test('product sync: an image deleted in the ERP leaves the store, a new main image goes first, and options changes reach Shopify', async () => {
  const p = getProduct(productId);
  const [a, b] = p.images;
  // التاجر حذف الصورة الأولى، وأضاف صورة جديدة جعلها الرئيسية، وأضاف لوناً ثالثاً
  updateProduct(p.id, {
    images: [{ url: 'https://cdn.example/new-main.jpg', alt: 'جديدة' }, b],
    options: [{ name: 'اللون', values: ['أزرق', 'وردي', 'أخضر'] }],
    variants: [...p.variants, { options: { اللون: 'أخضر' }, price: 5900, sku: 'TH-G' }],
  });
  const publishes = sent('publishablePublish').length;
  const out = await publishProduct(p.id, { status: 'ACTIVE' });
  assert.ok(sent('fileUpdate').some((c) => c.variables.files.some((f) => f.id === a.id && f.referencesToRemove[0] === shop.id)), 'deleted image detached from the product');
  assert.deepEqual(shop.media.map((m) => m.url), ['https://cdn.example/new-main.jpg', 'https://cdn.example/b.jpg'], 'ERP order: the new image is the main one');
  const set = sent('productSet').at(-1).variables.input;
  assert.equal(set.id, shop.id);
  assert.deepEqual(set.variants.map((v) => Boolean(v.id)), [true, true, false], 'existing colours keep their id (stock, orders); the new one is created');
  assert.equal(out.variants.length, 3);
  assert.equal(sent('publishablePublish').length, publishes, 'already on the Online Store: not published again');
});

test('product sync: stock adjusted in the ERP reaches Shopify at once (relative), per colour; table values are absolute', async () => {
  const p = getProduct(productId);
  const blue = p.variants.find((v) => v.options['اللون'] === 'أزرق');
  await assert.rejects(adjustStock(p.id, 5, { reason: 'وصول سلعة' }), /stock_variant_required/);
  const out = await adjustStock(p.id, 5, { reason: 'وصول سلعة', variantId: blue.id });
  const adj = sent('inventoryAdjustQuantities').at(-1);
  assert.equal(adj.variables.input.changes[0].delta, 5);
  assert.equal(adj.variables.input.reason, 'received');
  assert.match(adj.q, /@idempotent\(key: \$key\)/);
  assert.equal(out.variants.find((v) => v.id === blue.id).stock, 17);
  assert.equal(out.stock_synced, true);
  // اللون الجديد لم يكن متتبَّعاً: الكمية المطلقة من الجدول تصل، والتتبع يُفعَّل
  const green = out.variants.find((v) => v.options['اللون'] === 'أخضر');
  const after = await setVariantStock(p.id, [{ variant_id: green.id, quantity: 4 }]);
  const set = sent('inventorySetQuantities').at(-1);
  assert.deepEqual(set.variables.input.quantities[0], { inventoryItemId: shop.variants.find((v) => v.id === green.id).item, locationId: 'gid://shopify/Location/1', quantity: 4, changeFromQuantity: null });
  assert.equal(shop.variants.find((v) => v.id === green.id).tracked, true);
  assert.equal(after.variants.find((v) => v.id === green.id).stock, 4);
  assert.equal(after.stock, 17 + 7 + 4);
});

test('product sync: without write_publications the publish still succeeds and says why the product is not visible', async () => {
  scopes.publications = false;
  published = false;
  const out = await publishProduct(productId, { status: 'ACTIVE' });
  assert.deepEqual(out.warnings, ['online_store_scope_missing']);
  assert.equal(out.stage, 'published');
  scopes.publications = true;
});

test('product sync: a product without options sends its new price to its only variant; a colour added later gets its stock', async () => {
  const single = createProduct(project.id, { title: 'Gourde', price: 1500, stock: 10 });
  await publishProduct(single.id, { status: 'ACTIVE' });
  assert.equal(sent('productSet').at(-1).variables.input.variants[0].inventoryQuantities[0].quantity, 10);
  updateProduct(single.id, { price: 1700, compare_at_price: 2000 });
  await publishProduct(single.id, { status: 'ACTIVE' });
  const bulk = sent('productVariantsBulkUpdate').at(-1).variables.variants[0];
  assert.deepEqual([bulk.price, bulk.compareAtPrice], ['1700', '2000']);
  assert.equal(getProduct(single.id).price, 1700);
  // لون جديد بمخزونه على منتج منشور
  const p = getProduct(single.id);
  updateProduct(single.id, { options: [{ name: 'اللون', values: ['أسود'] }], variants: [{ options: { اللون: 'أسود' }, price: 1700, stock: 6 }] });
  await publishProduct(single.id, { status: 'ACTIVE' });
  const set = sent('productSet').at(-1).variables.input;
  assert.equal(set.id, p.shopify_id);
  assert.deepEqual(set.variants[0].inventoryQuantities, [{ locationId: 'gid://shopify/Location/1', name: 'available', quantity: 6 }]);
  assert.equal(getProduct(single.id).stock, 6);
});
