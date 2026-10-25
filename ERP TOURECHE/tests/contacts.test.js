import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createProduct, updateProduct } from '../server/services/products.js';
import { createOrder } from '../server/services/orders.js';
import { WILAYAS } from '../server/lib/wilayas.js';
import * as contacts from '../server/services/contacts.js';
import * as advisor from '../server/services/advisor.js';

const project = createProject({ name: 'Contacts Shop', domain: 'contacts.example' });
const insert = (input) => {
  const c = contacts.contactInput(input);
  const id = db
    .prepare('INSERT INTO contacts (project_id, name, kind, company, phone, email, notes, carrier, wilaya_code, role, lead_time_days) VALUES (@project_id, @name, @kind, @company, @phone, @email, @notes, @carrier, @wilaya_code, @role, @lead_time_days)')
    .run(c).lastInsertRowid;
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
};

test('contacts: input validation keeps only the fields each kind uses', () => {
  assert.throws(() => contacts.contactInput({ name: 'X', kind: 'customer' }), /kind_invalid/);
  assert.throws(() => contacts.contactInput({ name: 'Desk', kind: 'delivery' }), /carrier_required/);
  assert.throws(() => contacts.contactInput({ name: 'Desk', kind: 'delivery', carrier: 'dhl' }), /carrier_invalid/);
  assert.throws(() => contacts.contactInput({ kind: 'supplier' }), /name_required/);
  const s = contacts.contactInput({ name: 'Imprimerie', kind: 'supplier', phone: '+213 661 23 45 67', lead_time_days: '4', carrier: 'zr' });
  assert.equal(s.phone, '0661234567');
  assert.equal(s.lead_time_days, 4);
  assert.equal(s.carrier, null);
  const d = contacts.contactInput({ name: 'Bureau Sétif', kind: 'delivery', carrier: 'yalidine', wilaya_code: '19', lead_time_days: 9 });
  assert.equal(d.wilaya_code, 19);
  assert.equal(d.role, 'desk');
  assert.equal(d.lead_time_days, null);
});

test('contacts: supplier shows what to reorder and how much', () => {
  const sup = insert({ name: 'Imprimerie Alwani', kind: 'supplier', phone: '0661234567', lead_time_days: 4 });
  const p = createProduct(project.id, { title: 'Cahier de coloriage', price: 900, cost_price: 300, stock: 6, low_stock: 2 });
  const fine = createProduct(project.id, { title: 'Labyrinthes', price: 700, cost_price: 200, stock: 500, low_stock: 5 });
  updateProduct(p.id, { supplier_id: sup.id });
  updateProduct(fine.id, { supplier_id: sup.id });
  assert.equal(db.prepare('SELECT supplier FROM products WHERE id = ?').get(p.id).supplier, 'Imprimerie Alwani');
  assert.throws(() => updateProduct(p.id, { supplier_id: 999999 }), /supplier_invalid/);
  // 14 قطعة في آخر 14 يوماً ← قطعة في اليوم؛ المخزون 6 يكفي 6 أيام ≤ مدة التوريد 4 + 3
  for (let i = 0; i < 7; i++) createOrder(project.id, { customer_name: 'C', phone: `05500000${10 + i}`, wilaya_code: 16, items: [{ product_id: p.id, title: p.title, qty: 2, price: 900 }] });
  const { rows, counts } = contacts.listContacts([project.id], { kind: 'supplier' });
  const s = rows.find((r) => r.id === sup.id);
  assert.equal(counts.supplier >= 1, true);
  assert.equal(s.products.length, 2);
  assert.deepEqual(
    s.reorder.map((r) => r.id),
    [p.id],
  );
  assert.equal(s.reorder[0].days_left, 6);
  assert.equal(s.reorder[0].suggested_qty, 12); // (4 + 14) يوم × 1 − 6
});

test('contacts: delivery desks count stuck parcels for their carrier and wilaya', () => {
  const desk = insert({ name: 'Yalidine Sétif', kind: 'delivery', carrier: 'yalidine', wilaya_code: 19, phone: '0770000001' });
  const all = insert({ name: 'Yalidine account', kind: 'delivery', carrier: 'yalidine', role: 'manager' });
  const mk = (carrier, wilaya, status) => {
    const { id } = createOrder(project.id, { customer_name: 'S', phone: '0550111222', wilaya_code: wilaya, items: [{ title: 'x', qty: 1, price: 1000 }] });
    db.prepare('UPDATE orders SET carrier = ?, status = ? WHERE id = ?').run(carrier, status, id);
  };
  mk('yalidine', 19, 'at_office');
  mk('yalidine', 19, 'delivered');
  mk('noest', 19, 'attempt_failed');
  mk('yalidine', 16, 'attempt_failed');
  const rows = contacts.listContacts([project.id], { kind: 'delivery' }).rows;
  assert.equal(rows.find((r) => r.id === desk.id).stuck, 1);
  assert.equal(rows.find((r) => r.id === all.id).stuck, 2);

  // طلبية في ولاية جديدة (2026) تجد مكتب ولايتها الأم ومن يغطي كل الولايات
  const child = WILAYAS.find((w) => w.code > 58 && w.shipAs !== w.code);
  const parentDesk = insert({ name: 'Parent desk', kind: 'delivery', carrier: 'yalidine', wilaya_code: child.shipAs });
  const found = contacts.listContacts([project.id], { kind: 'delivery', carrier: 'yalidine', wilaya: child.code }).rows.map((r) => r.id);
  assert.ok(found.includes(parentDesk.id));
  assert.ok(found.includes(all.id));
  assert.ok(!found.includes(desk.id) || child.shipAs === 19);
});

test('advisor: stock alert names the supplier, its lead time and the quantity', () => {
  const out = advisor.analyze([project.id]);
  assert.deepEqual(out.errors, []);
  const i = out.insights.find((x) => x.key.startsWith('stock.out_soon:'));
  assert.ok(i, 'stock alert expected');
  assert.equal(i.action.to, '/contacts?kind=supplier');
  assert.ok(i.evidence.some((e) => e.value === 'Imprimerie Alwani'));
  assert.equal(i.severity, 'high');
  assert.match(i.advice.ar, /اطلب/);
  assert.doesNotMatch(i.advice.ar, /object/);
});
