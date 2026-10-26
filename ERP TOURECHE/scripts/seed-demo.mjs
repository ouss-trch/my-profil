// بيانات تجريبية للعرض فقط — لا تُشغَّل على قاعدة بياناتك الحقيقية: ERP_DATA_DIR=./demo-data node scripts/seed-demo.mjs "$PWD"
const root = process.argv[2];
const { db } = await import(`${root}/server/db/index.js`);
const { createProduct } = await import(`${root}/server/services/products.js`);
const { createOrder, changeStatus } = await import(`${root}/server/services/orders.js`);
const { createTest, updateTest } = await import(`${root}/server/services/splits.js`);
const { contactInput } = await import(`${root}/server/services/contacts.js`);
const project = db.prepare('SELECT * FROM projects ORDER BY id LIMIT 1').get();
const pid = project.id;
db.prepare("UPDATE products SET stage = stage").run();
const products = [
  createProduct(pid, { title: 'ترموس حافظ للحرارة 500 مل', price: 2900, cost_price: 1150, packaging_cost: 60, stock: 30, low_stock: 8, stage: 'published', shopify_id: 'gid://shopify/Product/1', handle: 'thermos-500', seo_score: 58, test_stage: 'testing' }),
  createProduct(pid, { title: 'منظم أدراج المطبخ', price: 2400, cost_price: 900, stock: 4, low_stock: 6, stage: 'published', shopify_id: 'gid://shopify/Product/2', handle: 'kitchen-organizer', seo_score: 81 }),
  createProduct(pid, { title: 'لعبة تعليمية للأطفال', price: 1900, cost_price: 1500, stock: 40, stage: 'published', shopify_id: 'gid://shopify/Product/3', handle: 'kids-toy', seo_score: 44 }),
  createProduct(pid, { title: 'مصباح ديكور LED', price: 3500, stock: 12, stage: 'draft', handle: 'led-lamp' }),
];
const wil = [16, 31, 9, 25, 19, 15, 6, 13, 35, 42, 5, 30, 47, 39];
const carriers = ['yalidine', 'zr', 'noest'];
let n = 0;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const iso = (daysAgo, h = 10) => new Date(Date.now() - daysAgo * 86400e3 - h * 3600e3).toISOString();
for (let d = 40; d >= 0; d--) {
  const count = 3 + Math.floor(Math.random() * 7);
  for (let k = 0; k < count; k++) {
    const p = Math.random() < 0.55 ? products[0] : rnd(products.slice(1, 3));
    const w = rnd(wil);
    const { id } = createOrder(pid, {
      ref: `D${d}-${k}-${n++}`,
      customer_name: rnd(['محمد', 'أمينة', 'ياسين', 'سارة', 'رضا', 'خديجة', 'Karim', 'Nadia']),
      phone: `0${rnd(['5', '6', '7'])}${String(10000000 + Math.floor(Math.random() * 89999999)).slice(0, 8)}`,
      wilaya: w,
      commune: 'Centre',
      delivery_type: Math.random() < 0.3 ? 'desk' : 'home',
      items: [{ title: p.title, product_id: p.id, qty: 1, price: p.price }],
      shipping_fee: 500,
      total: p.price + 500,
      utm_source: rnd(['fb', 'ig', 'fb', 'direct']),
      utm_content: d < 10 && p.id === products[0].id ? rnd(['thermos-lp-a', 'thermos-lp-b', 'thermos-lp-a']) : null,
      created_at: iso(d, Math.floor(Math.random() * 12)),
    });
    const r = Math.random();
    const age = d;
    const at = (x) => iso(Math.max(0, d - x));
    if (age === 0 && r < 0.6) continue;
    if (r < 0.12) { changeStatus(id, 'no_answer', { force: true, at: at(0) }); continue; }
    if (r < 0.2) { changeStatus(id, 'cancelled', { force: true, at: at(0), cancelReason: rnd(['السعر', 'طلب بالخطأ', 'لا يرد']) }); continue; }
    if (r < 0.23) { changeStatus(id, 'fake', { force: true, at: at(0) }); continue; }
    changeStatus(id, 'confirmed', { force: true, at: at(0) });
    if (age < 1) continue;
    db.prepare('UPDATE orders SET carrier = ? WHERE id = ?').run(w === 31 ? 'zr' : rnd(carriers), id);
    changeStatus(id, 'shipped', { force: true, at: at(1) });
    if (age < 3) { if (Math.random() < 0.5) changeStatus(id, rnd(['in_transit', 'at_office', 'out_for_delivery']), { force: true, at: at(2) }); continue; }
    if (age < 5 && Math.random() < 0.3) { changeStatus(id, rnd(['at_office', 'attempt_failed']), { force: true, at: at(3) }); continue; }
    const fail = w === 39 || w === 47 ? 0.5 : 0.18;
    changeStatus(id, Math.random() < fail ? 'returned' : 'delivered', { force: true, at: at(Math.min(age, 3 + Math.floor(Math.random() * 3))) });
  }
}
for (let i = 0; i < 6; i++) createOrder(pid, { ref: `AB${i}`, phone: `0550${String(100000 + i)}`, wilaya: 16, items: [{ title: products[0].title, product_id: products[0].id, qty: 1, price: 2900 }], total: 3400, status: 'abandoned', created_at: iso(i % 3) });
const t = createTest(pid, { name: 'Thermos LP', slug: 'thermos-lp', product_id: products[0].id, variants: [{ name: 'صفحة المنتج', url: 'https://souqnna.com/products/thermos-500', weight: 1 }, { name: 'صفحة هبوط', url: 'https://souqnna.com/pages/thermos', weight: 1 }] });
updateTest(t.id, { status: 'running' });
db.prepare("UPDATE split_tests SET started_at = ? WHERE id = ?").run(iso(12), t.id);
const st = db.prepare('INSERT INTO split_clicks (test_id, variant_id, visitor, at) VALUES (?, ?, ?, ?)');
for (let i = 0; i < 420; i++) st.run(t.id, t.variants[0].id, `a${i}`.padEnd(16, '0'), iso(i % 10));
for (let i = 0; i < 400; i++) st.run(t.id, t.variants[1].id, `b${i}`.padEnd(16, '0'), iso(i % 10));
const sp = db.prepare("INSERT INTO ad_spend (project_id, account_id, campaign_id, date, campaign_name, spend, currency, impressions, clicks, purchases, purchase_value, updated_at) VALUES (?, '1021341893008834', 'c1', ?, 'Thermos FB+IG', ?, 'EUR', ?, ?, ?, 0, ?)");
for (let d = 20; d >= 0; d--) sp.run(pid, new Date(Date.now() + 3600e3 - d * 86400e3).toISOString().slice(0, 10), 4 + Math.random() * 3, 3000, 60, 3, new Date().toISOString());
// الموردون ومكاتب التوصيل (بيانات توضيحية)
const addContact = (c) =>
  db
    .prepare('INSERT INTO contacts (project_id, name, kind, company, phone, email, notes, carrier, wilaya_code, role, lead_time_days) VALUES (@project_id, @name, @kind, @company, @phone, @email, @notes, @carrier, @wilaya_code, @role, @lead_time_days)')
    .run(contactInput(c)).lastInsertRowid;
const supA = addContact({ name: 'مؤسسة النور للأواني', kind: 'supplier', company: 'El Eulma', phone: '0661000101', lead_time_days: 3, notes: 'الدفع نقداً عند الاستلام · أقل كمية 50' });
const supB = addContact({ name: 'Bazar Kids Import', kind: 'supplier', company: 'Alger · Hamiz', phone: '0770000202', lead_time_days: 6 });
db.prepare('UPDATE products SET supplier_id = ?, supplier = ? WHERE id IN (?, ?)').run(supA, 'مؤسسة النور للأواني', products[0].id, products[1].id);
db.prepare('UPDATE products SET supplier_id = ?, supplier = ? WHERE id = ?').run(supB, 'Bazar Kids Import', products[2].id);
addContact({ name: 'Yalidine Sétif (Stop desk)', kind: 'delivery', carrier: 'yalidine', wilaya_code: 19, phone: '0560000303' });
addContact({ name: 'Yalidine Oran', kind: 'delivery', carrier: 'yalidine', wilaya_code: 31, phone: '0560000404' });
addContact({ name: 'Karim · livreur ZR', kind: 'delivery', carrier: 'zr', wilaya_code: 16, role: 'livreur', phone: '0550000505' });
addContact({ name: 'NOEST · chargé de compte', kind: 'delivery', carrier: 'noest', role: 'manager', phone: '0550000606' });
addContact({ name: 'مطبعة الفجر', kind: 'service', company: 'طباعة العلب والملصقات', phone: '0661000707' });
addContact({ name: 'Librairie El Ilm', kind: 'wholesale', company: 'Blida', phone: '0770000808', notes: 'سعر الجملة −25% ابتداءً من 20 قطعة' });
// التحصيل: أرقام تتبع، رصيد افتتاحي قبل 25 يوماً، ودفعة Yalidine حديثة بفرق صغير
const { openingBalance, recordPayout, openOrders } = await import(`${root}/server/services/collections.js`);
db.prepare("UPDATE orders SET tracking = upper(substr(carrier, 1, 3)) || '-' || printf('%06d', id * 7919 % 1000000) WHERE carrier IS NOT NULL AND tracking IS NULL").run();
openingBalance(pid, { before: new Date(Date.now() + 3600e3 - 25 * 86400e3).toISOString().slice(0, 10) });
const paid = openOrders([pid], { carrier: 'yalidine' }).filter((o) => o.days >= 9 && o.days <= 16);
if (paid.length) recordPayout(pid, { carrier: 'yalidine', order_ids: paid.map((o) => o.id), amount: paid.reduce((a, o) => a + o.net, 0) - 400, reference: 'YAL-V-2026-118' });
// المرتجعات (توضيحية): كأنها طلبيات Shopify عادت إلى المخزون؛ واحدة تالفة، واحدة لم تصل إلى Shopify، واثنتان قديمتان لم تُعالجا
const rets = db.prepare('SELECT id, order_id, items FROM order_returns ORDER BY id').all();
rets.forEach((r, k) => {
  if (k >= rets.length - 2) {
    db.prepare('DELETE FROM order_returns WHERE id = ?').run(r.id);
    return;
  }
  const items = JSON.parse(r.items).map((i) => ({ ...i, variant_id: `gid://shopify/ProductVariant/${i.product_id || 0}`, why: null }));
  if (k === 0) Object.assign(items[0], { back: 0, loss: 'damaged' });
  db.prepare('UPDATE orders SET external_id = ? WHERE id = ?').run(`gid://shopify/Order/${9000 + r.order_id}`, r.order_id);
  const failed = k === 1;
  db.prepare('UPDATE order_returns SET items = ?, goods_lost = ?, shopify_state = ?, shopify_applied = ?, shopify_error = ? WHERE id = ?').run(
    JSON.stringify(items),
    items.reduce((a, i) => a + (i.qty - i.back) * (i.unit_cost || 0), 0),
    failed ? 'failed' : 'done',
    failed ? '{}' : JSON.stringify(Object.fromEntries(items.map((i) => [i.variant_id, i.back]))),
    failed ? 'shopify: access_denied (write_inventory)' : null,
    r.id,
  );
});
console.log('seeded', n, 'orders');
