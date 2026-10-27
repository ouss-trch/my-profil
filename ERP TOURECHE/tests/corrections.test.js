import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting, projectConfig } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { changeStatus, createOrder, getOrder } from '../server/services/orders.js';
import { archiveProduct, createProduct, deleteProduct, listProducts } from '../server/services/products.js';
import { addCollectionToMenu, mainMenu, menuResourceIds } from '../server/integrations/shopify.js';

// ——— Shopify وهمي: القائمة الرئيسية (3 مجموعات + رابط عادي) وتعديل المنتج والقائمة ———
const calls = [];
let menuItems = [
  { id: 'gid://shopify/MenuItem/1', title: 'الأطفال', type: 'COLLECTION', resourceId: 'gid://shopify/Collection/1', url: '/fr/collections/kids', tags: [], items: [] },
  { id: 'gid://shopify/MenuItem/2', title: 'الرجال', type: 'COLLECTION', resourceId: 'gid://shopify/Collection/2', url: '/fr/collections/men', tags: [], items: [] },
  { id: 'gid://shopify/MenuItem/3', title: 'العروض', type: 'HTTP', resourceId: null, url: 'https://souqnna.com/pages/offres', tags: [], items: [] },
];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!u.includes('corrections-test.myshopify.com')) throw new Error(`unexpected ${u}`);
  const body = JSON.parse(init.body);
  calls.push(body);
  if (body.query.includes('menuUpdate')) {
    menuItems = body.variables.items;
    return json({ data: { menuUpdate: { menu: { id: body.variables.id }, userErrors: [] } } });
  }
  if (body.query.includes('menus(')) {
    return json({
      data: {
        menus: {
          nodes: [
            { id: 'gid://shopify/Menu/9', title: 'Footer menu', handle: 'footer', isDefault: true, items: [] },
            { id: 'gid://shopify/Menu/8', title: 'Main menu', handle: 'main-menu', isDefault: true, items: menuItems },
          ],
        },
      },
    });
  }
  if (body.query.includes('productUpdate')) return json({ data: { productUpdate: { product: { id: body.variables.product.id }, userErrors: [] } } });
  throw new Error(`unexpected query ${body.query.slice(0, 60)}`);
};

const project = createProject({ name: 'Corrections Shop', domain: 'corrections.example' });
setSetting('shopify_shop', 'corrections-test.myshopify.com', project.id);
setSetting('shopify_access_token', 'shpat_test', project.id);

test('orders: a mistaken confirm or cancel can be corrected', () => {
  const { id } = createOrder(project.id, { customer_name: 'Amina', phone: '0550998877', wilaya_code: 16, items: [{ title: 'Thermos', qty: 1, price: 5900 }], shipping_fee: 700 }, { source: 'manual' });
  changeStatus(id, 'confirmed');
  // الزبون لم يرد في الحقيقة: من «مؤكدة» إلى «لا يرد» مباشرة
  assert.equal(changeStatus(id, 'no_answer').status, 'no_answer');
  changeStatus(id, 'confirmed');
  assert.equal(changeStatus(id, 'callback').status, 'callback');
  changeStatus(id, 'cancelled', { cancelReason: 'test' });
  assert.equal(changeStatus(id, 'no_answer').status, 'no_answer');
  changeStatus(id, 'fake');
  assert.equal(changeStatus(id, 'cancelled').status, 'cancelled');
  assert.equal(getOrder(id).closed_at !== null, true);
  // الانتقالات غير المنطقية تبقى ممنوعة: من «لا يرد» إلى «تم التسليم»
  assert.throws(() => changeStatus(id, 'delivered'), /transition_not_allowed/);
});

test('products: ERP-only products are deleted, Shopify products are archived (never re-imported by sync)', async () => {
  const local = createProduct(project.id, { title: 'روب', price: 3500 });
  deleteProduct(local.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE id = ?').get(local.id).n, 0);

  const live = createProduct(project.id, { title: 'Thermos', price: 5900 });
  db.prepare("UPDATE products SET shopify_id = 'gid://shopify/Product/77', stage = 'published' WHERE id = ?").run(live.id);
  assert.throws(() => deleteProduct(live.id), /product_on_shopify_archive/);
  const out = await archiveProduct(live.id);
  assert.equal(out.stage, 'archived');
  const sent = calls.find((c) => c.query.includes('productUpdate'));
  assert.deepEqual(sent.variables.product, { id: 'gid://shopify/Product/77', status: 'ARCHIVED' });
  assert.equal(listProducts([project.id]).some((p) => p.id === live.id), false);
  assert.equal(listProducts([project.id], { stage: 'archived' }).some((p) => p.id === live.id), true);
});

test('menu: a collection missing from the main menu is appended, the rest kept as is', async () => {
  const cfg = projectConfig(project.id);
  const menu = await mainMenu(cfg);
  assert.equal(menu.handle, 'main-menu');
  assert.deepEqual(menuResourceIds(menu.items), ['gid://shopify/Collection/1', 'gid://shopify/Collection/2']);

  const r = await addCollectionToMenu(cfg, { id: 'gid://shopify/Collection/4', title: 'إكسسوارات' });
  assert.deepEqual(r, { menu: 'Main menu', added: true });
  const update = calls.findLast((c) => c.query.includes('menuUpdate'));
  assert.equal(update.variables.id, 'gid://shopify/Menu/8');
  assert.equal(update.variables.title, 'Main menu');
  const items = update.variables.items;
  assert.equal(items.length, 4);
  // العناصر القديمة بمعرّفاتها؛ المجموعة بمعرّفها دون رابط اللغة، والرابط العادي برابطه
  assert.deepEqual(items[0], { id: 'gid://shopify/MenuItem/1', title: 'الأطفال', type: 'COLLECTION', tags: [], resourceId: 'gid://shopify/Collection/1', items: [] });
  assert.deepEqual(items[2], { id: 'gid://shopify/MenuItem/3', title: 'العروض', type: 'HTTP', tags: [], url: 'https://souqnna.com/pages/offres', items: [] });
  assert.deepEqual(items[3], { title: 'إكسسوارات', type: 'COLLECTION', resourceId: 'gid://shopify/Collection/4' });

  // مرة ثانية: موجودة فعلاً، لا تعديل
  const before = calls.filter((c) => c.query.includes('menuUpdate')).length;
  assert.deepEqual(await addCollectionToMenu(cfg, { id: 'gid://shopify/Collection/4', title: 'إكسسوارات' }), { menu: 'Main menu', added: false });
  assert.equal(calls.filter((c) => c.query.includes('menuUpdate')).length, before);
});
