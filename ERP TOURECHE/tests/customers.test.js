import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { createOrder, changeStatus, customerSummary, getOrder, setCustomerFlag } from '../server/services/orders.js';
import { assess, callLessons, forgetLessons, listCustomerProfiles } from '../server/services/customers.js';

const project = createProject({ name: 'Customers shop', domain: 'customers.example' });
let n = 0;
const phone = (i) => `0550${String(100000 + i).slice(-6)}`;
/** طلبية بتاريخها: عدد مرات «لا يرد» قبل التأكيد، ثم مصيرها */
function order(p, { calls = 0, end = 'delivered', fails = 0, raw = null } = {}) {
  const { id } = createOrder(project.id, { ref: `C-${++n}`, phone: p, wilaya: 16, items: [{ title: 'T', qty: 1, price: 3000 }] }, { source: 'manual' });
  for (let i = 0; i < calls; i++) changeStatus(id, 'no_answer');
  if (end === 'cancelled_unreached') return changeStatus(id, 'cancelled', { cancelReason: 'لا يرد' });
  if (end === 'fake') return changeStatus(id, 'fake');
  changeStatus(id, 'confirmed');
  if (end === 'changed_mind') return changeStatus(id, 'cancelled', { cancelReason: 'غيّر رأيه' });
  if (end === 'open') return getOrder(id);
  changeStatus(id, 'shipped');
  for (let i = 0; i < fails; i++) {
    changeStatus(id, 'attempt_failed', { force: true });
    changeStatus(id, 'out_for_delivery', { force: true });
  }
  if (raw) db.prepare("INSERT INTO order_events (order_id, type, raw, source, at) VALUES (?, 'carrier', ?, 'carrier', ?)").run(id, raw, new Date().toISOString());
  return changeStatus(id, end, { force: true });
}

// تاريخ المتجر: من يُؤكَّد دون «لا يرد» يُسلَّم غالباً، ومن لم يرد 3 مرات يرجع طرده كثيراً
for (let i = 0; i < 40; i++) order(phone(1000 + i), { calls: 0, end: i < 34 ? 'delivered' : 'returned' }); // 85%
for (let i = 0; i < 20; i++) order(phone(2000 + i), { calls: 3, end: i < 9 ? 'delivered' : 'returned' }); // 45%

test('customers: the store’s own data says how often a customer who did not answer is delivered', () => {
  forgetLessons(); // الطلبيات أعلاه فتحت الطلبية (getOrder) فخُزّنت نسب قديمة لدقيقة
  const l = callLessons([project.id]);
  assert.equal(l.closed, 60);
  assert.equal(l.base, round3(43 / 60));
  const r0 = l.byCalls.find((b) => b.calls === 0).rate;
  const r3 = l.byCalls.find((b) => b.calls === 3).rate;
  assert.ok(r0 > 0.78 && r3 < 0.58, `0 calls ${r0} vs 3+ calls ${r3}`);
});
const round3 = (x) => Math.round(x * 1000) / 1000;

test('customers: trusted, new, no-answer, refusal, fake and blacklisted customers are told apart, with their reasons', () => {
  const trusted = phone(1);
  order(trusted);
  order(trusted);
  const fresh = phone(2);
  order(fresh, { end: 'open' });
  const silent = phone(3);
  const silentOrder = order(silent, { calls: 3, end: 'open' });
  const refuser = phone(4);
  order(refuser, { fails: 1, raw: 'Echec livraison : Client refuse le colis', end: 'returned' });
  const faker = phone(5);
  order(faker, { end: 'fake' });
  const ghost = phone(7); // طلبيتان أُلغيتا لأنه لم يرد أبداً
  order(ghost, { calls: 2, end: 'cancelled_unreached' });
  order(ghost, { calls: 2, end: 'cancelled_unreached' });
  const fickle = phone(8); // أكّد مرتين ثم تراجع
  order(fickle, { end: 'changed_mind' });
  order(fickle, { end: 'changed_mind' });
  const courier = phone(9); // لم يرد على الموزع ثم سُلّم
  order(courier, { fails: 1, raw: 'Tentative échouée : client injoignable, téléphone éteint' });
  const banned = phone(6);
  order(banned);
  setCustomerFlag(banned, { blacklisted: true, reason: 'رفض مرتين' });

  forgetLessons();
  const { rows, counts, lessons } = listCustomerProfiles([project.id], { limit: 500 });
  const by = Object.fromEntries(rows.map((r) => [r.phone, r]));
  assert.equal(by[trusted].level, 'trusted');
  assert.ok(by[trusted].p_deliver > 85);
  assert.deepEqual(by[trusted].reasons, [{ code: 'delivered', n: 2, good: true }]);
  assert.equal(by[trusted].advice, 'fast_track');
  assert.equal(by[fresh].level, 'new');
  // 3 مرات «لا يرد» على طلبيته الحالية: احتمال التسليم كمن سبقوه في المتجر (≈ 45–55%) ← خطر أو متوسط، ونصيحة تأكيد مضاعف
  assert.ok(['medium', 'high'].includes(by[silent].level), by[silent].level);
  assert.ok(by[silent].p_deliver < lessons.base * 100 * 0.9);
  assert.deepEqual(by[silent].reasons, [{ code: 'no_answer', n: 3 }]);
  assert.equal(by[refuser].level, 'high');
  assert.deepEqual(by[refuser].reasons.map((r) => r.code), ['returned', 'refused', 'delivery_failed']);
  assert.equal(by[refuser].advice, 'deposit_or_desk');
  assert.deepEqual([by[faker].level, by[faker].advice], ['high', 'fake_before']);
  assert.equal(by[ghost].level, 'high');
  assert.deepEqual(by[ghost].reasons, [{ code: 'no_answer', n: 4 }, { code: 'unreached', n: 2 }]);
  assert.deepEqual(by[fickle].reasons, [{ code: 'changed_mind', n: 2 }]);
  assert.notEqual(by[fickle].level, 'trusted');
  assert.deepEqual(by[courier].reasons.map((r) => r.code), ['delivered', 'delivery_failed', 'courier_no_answer']);
  assert.notEqual(by[courier].level, 'trusted', 'delivered after not answering the courier: not «trusted» yet');
  assert.deepEqual([by[banned].level, by[banned].p_deliver, by[banned].reasons[0].code], ['high', 0, 'blacklisted']);
  assert.equal(counts.trusted >= 1 && counts.new >= 1 && counts.high >= 3, true);
  // الأخطر أولاً عند الترتيب بالخطر
  const sorted = listCustomerProfiles([project.id], { sort: 'risk', limit: 3 }).rows;
  assert.equal(sorted[0].phone, banned);
  // في الطلبية نفسها: نفس التقييم + الطلبيات الأخرى المفتوحة
  const s = customerSummary(silent, silentOrder.id);
  assert.equal(s.level, by[silent].level);
  assert.equal(s.risk, s.level);
  assert.equal(s.open_duplicates, 0);
});

test('customers: a returned parcel weighs more than many deliveries cannot erase, and data beats the default when it exists', () => {
  const lessons = { base: 0.75, byCalls: [0.8, 0.7, 0.6, 0.5].map((rate, calls) => ({ calls, rate })), byFails: [0.8, 0.5, 0.4].map((rate, attempts) => ({ attempts, rate })) };
  const s = (x) => ({ orders: 1, delivered: 0, returned: 0, fake: 0, unreached: 0, changed_mind: 0, no_answer_calls: 0, delivery_failed: 0, carrier_unreachable: 0, refused: 0, open: 0, blacklisted: 0, ...x });
  const loyal = assess(s({ orders: 6, delivered: 5, returned: 1 }), lessons);
  assert.equal(loyal.level, 'low', 'a returned parcel among 5 deliveries: no longer «trusted», not risky');
  const twoReturns = assess(s({ orders: 2, returned: 2 }), lessons);
  assert.equal(twoReturns.level, 'high');
  const unreachable = assess(s({ orders: 2, carrier_unreachable: 2, no_answer_calls: 2 }), lessons);
  assert.equal(unreachable.level, 'high', 'not answering the courier twice');
  assert.equal(assess(s({}), lessons).level, 'new');
});
