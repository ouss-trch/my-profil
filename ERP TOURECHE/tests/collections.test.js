import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { addDays, dzDay, dzDayStartIso } from '../server/lib/util.js';
import { createProject } from '../server/services/projects.js';
import { createOrder } from '../server/services/orders.js';
import * as collections from '../server/services/collections.js';
import * as advisor from '../server/services/advisor.js';

const project = createProject({ name: 'Collect Shop', domain: 'collect.example' });
const today = dzDay();
let seq = 0;
/** طلبية أُغلقت قبل `daysAgo` يوماً عند شركة التوصيل */
const closed = ({ daysAgo, status = 'delivered', carrier = 'yalidine', total = 3000, fee = 500 }) => {
  const o = createOrder(project.id, { customer_name: 'Z', phone: '0550000000', wilaya_code: 16, items: [{ title: 'x', qty: 1, price: total }] });
  const at = new Date(Date.parse(dzDayStartIso(addDays(today, -daysAgo))) + 10 * 3600e3).toISOString();
  const tracking = `YAL-${String(++seq).padStart(6, '0')}`;
  db.prepare(`UPDATE orders SET status = ?, carrier = ?, tracking = ?, total = ?, shipping_cost = ?, ${status === 'delivered' ? 'delivered_at' : 'returned_at'} = ?, closed_at = ? WHERE id = ?`).run(status, carrier, tracking, total, fee, at, at, o.id);
  return { id: o.id, tracking };
};
const insight = (key) => advisor.analyze([project.id]).insights.find((i) => i.key === key);

// تاريخ قديم (قبل بدء التتبع) + طلبيات حديثة
const old = Array.from({ length: 10 }, () => closed({ daysAgo: 60 }));
const late = [closed({ daysAgo: 20 }), closed({ daysAgo: 18, total: 5000, fee: 600 })];
const fresh = [closed({ daysAgo: 3 }), closed({ daysAgo: 2, carrier: 'noest' })];
const ret = closed({ daysAgo: 4, status: 'returned' });
const noFee = closed({ daysAgo: 1, carrier: 'zr', fee: null });
db.prepare("INSERT OR REPLACE INTO carrier_tariffs (project_id, carrier, wilaya_code, home_fee, desk_fee, return_fee) VALUES (?, 'yalidine', 16, 500, 350, 200)").run(project.id);

test('collections: what each carrier still holds = delivered cash − delivery fees − return fees', () => {
  const s = collections.summary([project.id]);
  const y = s.carriers.find((c) => c.carrier === 'yalidine');
  assert.equal(s.started, false);
  assert.equal(y.delivered_count, 13);
  assert.equal(y.returned_count, 1);
  assert.equal(y.cash, 12 * 3000 + 5000);
  assert.equal(y.net, 12 * 2500 + 4400 - 200);
  assert.equal(y.oldest_days, 60);
  assert.equal(y.fee_unknown, 0);
  assert.equal(s.carriers.find((c) => c.carrier === 'noest').fee_unknown, 0);
  const zr = s.carriers.find((c) => c.carrier === 'zr');
  assert.equal(zr.fee_unknown, 1, 'no shipping cost and no tariff: flagged, not silently trusted');
  assert.equal(zr.net, 3000);
  assert.equal(collections.openOrders([project.id], { carrier: 'zr' })[0].id, noFee.id);
});

test('collections: before tracking starts, the Advisor suggests an opening balance instead of a false debt', () => {
  assert.equal(insight(`setup.collections:${project.id}`)?.severity, 'low');
  assert.equal(insight(`finance.collect:${project.id}:yalidine`), undefined);
});

test('collections: opening balance settles everything closed before the date, newer orders stay open', () => {
  const out = collections.openingBalance(project.id, { before: addDays(today, -30) });
  assert.deepEqual(out, [{ carrier: 'yalidine', orders_count: 10, expected: 25000 }]);
  const open = collections.openOrders([project.id], { carrier: 'yalidine' });
  assert.deepEqual(open.map((o) => o.id).sort(), [...late, fresh[0], ret].map((o) => o.id).sort());
  assert.equal(collections.summary([project.id]).started, true);
});

test('collections: carrier late more than 14 days raises an alert with the amount', () => {
  const a = insight(`finance.collect:${project.id}:yalidine`);
  assert.equal(a.severity, 'medium');
  assert.equal(a.impact_da, 2500 + 4400);
  assert.equal(insight(`setup.collections:${project.id}`), undefined);
});

test('collections: pasting the statement matches open parcels and flags the rest', () => {
  const text = `Versement 0042\n${late[0].tracking.toLowerCase()} 3000 DA\n${late[1].tracking}; ${old[0].tracking}, YAL-999999\n${ret.tracking}`;
  const pending = createOrder(project.id, { customer_name: 'P', phone: '0550000001', wilaya_code: 16, items: [{ title: 'x', qty: 1, price: 1 }] });
  db.prepare("UPDATE orders SET status = 'in_transit', carrier = 'yalidine', tracking = 'YAL-777777' WHERE id = ?").run(pending.id);
  const m = collections.matchStatement([project.id], { carrier: 'yalidine', text: `${text}\nYAL-777777` });
  assert.deepEqual(m.open.map((o) => o.id).sort(), [late[0].id, late[1].id, ret.id].sort());
  assert.deepEqual(m.already_paid.map((o) => o.id), [old[0].id]);
  assert.deepEqual(m.not_closed.map((o) => o.id), [pending.id]);
  assert.deepEqual(m.unknown, ['YAL-999999'], 'statement words like "Versement" are not tracking numbers');
  assert.equal(m.expected, 2500 + 4400 - 200);
  assert.throws(() => collections.matchStatement([project.id], { text: '  ' }), /trackings_required/);
});

test('collections: recording a payout links its orders, shows the gap, and cannot pay the same parcel twice', () => {
  const ids = [late[0].id, late[1].id, ret.id];
  const p = collections.recordPayout(project.id, { carrier: 'yalidine', order_ids: ids, amount: 6500, reference: 'V-0042' });
  assert.equal(p.expected, 6700);
  assert.equal(p.diff, -200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE payout_id = ?').get(p.id).n, 3);
  assert.throws(() => collections.recordPayout(project.id, { carrier: 'yalidine', order_ids: ids, amount: 1 }), /payout_orders_changed/);
  assert.throws(() => collections.recordPayout(project.id, { carrier: 'noest', order_ids: [fresh[0].id], amount: 1 }), /payout_orders_changed/);
  assert.throws(() => collections.recordPayout(project.id, { carrier: 'yalidine', order_ids: [], amount: 1 }), /orders_required/);
  assert.equal(insight(`finance.collect:${project.id}:yalidine`), undefined);
  const listed = collections.summary([project.id]).payouts.find((x) => x.id === p.id);
  assert.equal(listed.diff, -200);
  assert.equal(listed.reference, 'V-0042');
});

test('collections: deleting a payout reopens its orders', () => {
  const p = collections.summary([project.id]).payouts.find((x) => x.reference === 'V-0042');
  assert.equal(collections.payoutOrders(p.id).length, 3);
  collections.deletePayout(p.id);
  assert.equal(collections.openOrders([project.id], { carrier: 'yalidine' }).length, 4);
});
