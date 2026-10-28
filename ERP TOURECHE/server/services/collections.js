import { db } from '../db/index.js';
import { CARRIER_KEYS } from '../integrations/carriers/index.js';
import { HttpError, badRequest, daysBetween, dzDay, dzDayStartIso, addDays, nowIso, orderNumber, round, v } from '../lib/util.js';
import { inList } from './projects.js';
import { tariff } from './shipments.js';

/**
 * التحصيل: شركة التوصيل تقبض ثمن الطلبية من الزبون ثم تدفعه لك على دفعات، بعد خصم سعر التوصيل
 * وسعر إرجاع الطرود المرتجعة. كل طلبية مسلّمة أو مرتجعة تبقى «مفتوحة» حتى تُربط بالدفعة التي سوّتها.
 */
export const WAIT_DAYS = 14;
const OPEN = "status IN ('delivered','returned') AND carrier IS NOT NULL AND payout_id IS NULL";

const closedOn = (o) => o.delivered_at || o.returned_at || o.closed_at || o.updated_at;

/** صافي ما يجب أن يصلك من طلبية: المسلّمة = المبلغ − سعر التوصيل؛ المرتجعة = − سعر الإرجاع */
export function expectedNet(o) {
  const t = tariff(o.project_id, o.carrier, o.wilaya_code, o.delivery_type);
  // سعر غير معروف (لا تكلفة على الطلبية ولا تعريفة): يُحسب صفراً ويُعلَّم، لأن المتوقع سيكون أعلى من الحقيقي
  if (o.status === 'returned') {
    const fee = t?.return_fee;
    return { cash: 0, fee: round(fee || 0), net: round(-(fee || 0)), fee_known: fee !== null && fee !== undefined };
  }
  const fee = o.shipping_cost ?? t?.fee;
  return { cash: round(o.total), fee: round(fee || 0), net: round(o.total - (fee || 0)), fee_known: fee !== null && fee !== undefined };
}

const row = (o, today = dzDay()) => {
  const at = closedOn(o);
  const day = at ? dzDay(new Date(at)) : null;
  return {
    id: o.id,
    project_id: o.project_id,
    number: orderNumber(o),
    tracking: o.tracking,
    carrier: o.carrier,
    status: o.status,
    customer_name: o.customer_name,
    wilaya_code: o.wilaya_code,
    closed_on: day,
    days: day ? Math.max(0, Math.floor(daysBetween(dzDayStartIso(day), dzDayStartIso(today)))) : null,
    ...expectedNet(o),
  };
};

export function openOrders(projectIds, { carrier } = {}) {
  const args = [...projectIds];
  let sql = `SELECT * FROM orders WHERE project_id IN (${inList(projectIds)}) AND ${OPEN}`;
  if (carrier) {
    sql += ' AND carrier = ?';
    args.push(carrier);
  }
  const today = dzDay();
  return db
    .prepare(`${sql} ORDER BY COALESCE(delivered_at, returned_at, closed_at), id`)
    .all(...args)
    .map((o) => row(o, today));
}

/** لكل شركة: كم عندها لك، منذ متى، وهل بدأ التتبع (أول دفعة أو رصيد افتتاحي) */
export function summary(projectIds) {
  const open = openOrders(projectIds);
  const started = db.prepare(`SELECT carrier, COUNT(*) AS n, MAX(received_on) AS last FROM carrier_payouts WHERE project_id IN (${inList(projectIds)}) GROUP BY carrier`).all(...projectIds);
  const keys = [...new Set([...open.map((o) => o.carrier), ...started.map((s) => s.carrier)])];
  const carriers = keys
    .map((carrier) => {
      const list = open.filter((o) => o.carrier === carrier);
      const delivered = list.filter((o) => o.status === 'delivered');
      const s = started.find((x) => x.carrier === carrier);
      return {
        carrier,
        started: Boolean(s),
        last_payout: s?.last || null,
        delivered_count: delivered.length,
        returned_count: list.length - delivered.length,
        cash: round(list.reduce((a, o) => a + o.cash, 0)),
        fees: round(list.reduce((a, o) => a + o.fee, 0)),
        net: round(list.reduce((a, o) => a + o.net, 0)),
        oldest_days: delivered.length ? Math.max(...delivered.map((o) => o.days || 0)) : 0,
        fee_unknown: list.filter((o) => !o.fee_known).length,
        late_count: delivered.filter((o) => o.days > WAIT_DAYS).length,
        late_net: round(delivered.filter((o) => o.days > WAIT_DAYS).reduce((a, o) => a + o.net, 0)),
      };
    })
    .sort((a, b) => b.net - a.net);
  return {
    wait_days: WAIT_DAYS,
    started: started.length > 0,
    total_net: round(carriers.reduce((a, c) => a + c.net, 0)),
    carriers,
    payouts: listPayouts(projectIds),
  };
}

export function listPayouts(projectIds, limit = 50) {
  return db
    .prepare(`SELECT p.*, u.display_name AS created_by_name FROM carrier_payouts p LEFT JOIN users u ON u.id = p.created_by WHERE p.project_id IN (${inList(projectIds)}) ORDER BY p.received_on DESC, p.id DESC LIMIT ?`)
    .all(...projectIds, limit)
    .map((p) => ({ ...p, diff: p.kind === 'payout' ? round(p.amount - p.expected) : 0 }));
}

/**
 * مطابقة كشف الدفع: الصق أرقام التتبع كما في كشف الشركة (سطر لكل رقم أو مفصولة بفواصل).
 * النتيجة: الطلبيات المفتوحة المطابقة، وما سبق دفعه، وما لم يُسلَّم بعد في الـ ERP، والأرقام المجهولة.
 */
export function matchStatement(projectIds, { carrier, text }) {
  // رقم التتبع فيه رقم واحد على الأقل: كلمات الكشف (Relevé، Versement…) لا تُعدّ أرقاماً مجهولة
  const tokens = [...new Set((String(text || '').toUpperCase().match(/[A-Z0-9][A-Z0-9-]{4,}/g) || []).filter((x) => /\d/.test(x)))].slice(0, 2000);
  if (!tokens.length) throw badRequest('trackings_required');
  const args = [...projectIds, ...tokens];
  let sql = `SELECT * FROM orders WHERE project_id IN (${inList(projectIds)}) AND upper(tracking) IN (${inList(tokens)})`;
  if (carrier) {
    sql += ' AND carrier = ?';
    args.push(carrier);
  }
  const found = db.prepare(sql).all(...args);
  const today = dzDay();
  const byTracking = new Map(found.map((o) => [String(o.tracking).toUpperCase(), o]));
  const out = { open: [], already_paid: [], not_closed: [], unknown: [] };
  for (const tk of tokens) {
    const o = byTracking.get(tk);
    if (!o) out.unknown.push(tk);
    else if (o.payout_id) out.already_paid.push({ ...row(o, today), payout_id: o.payout_id });
    else if (!['delivered', 'returned'].includes(o.status)) out.not_closed.push(row(o, today));
    else out.open.push(row(o, today));
  }
  return { ...out, expected: round(out.open.reduce((a, o) => a + o.net, 0)) };
}

/** تسجيل دفعة مستلمة وربط طلبياتها. المتوقع يُحسب من الطلبيات، والفرق يظهر فوراً */
export function recordPayout(projectId, b, { userId } = {}) {
  const carrier = v.oneOf(b.carrier, CARRIER_KEYS, { required: true, name: 'carrier' });
  const ids = [...new Set((Array.isArray(b.order_ids) ? b.order_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw badRequest('orders_required');
  const amount = v.num(b.amount, { required: true, min: 0, max: 1e10, name: 'amount' });
  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(b.received_on)) ? b.received_on : dzDay();
  return db.transaction(() => {
    const orders = db.prepare(`SELECT * FROM orders WHERE id IN (${inList(ids)}) AND project_id = ? AND carrier = ? AND ${OPEN}`).all(...ids, projectId, carrier);
    if (orders.length !== ids.length) throw new HttpError(409, 'payout_orders_changed', 'payout_orders_changed', { valid: orders.length, sent: ids.length });
    const expected = round(orders.reduce((a, o) => a + expectedNet(o).net, 0));
    const info = db
      .prepare('INSERT INTO carrier_payouts (project_id, carrier, kind, received_on, amount, expected, orders_count, reference, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, carrier, 'payout', receivedOn, amount, expected, orders.length, v.str(b.reference, { max: 80 }), v.str(b.note, { max: 500 }), userId || null, nowIso());
    db.prepare(`UPDATE orders SET payout_id = ? WHERE id IN (${inList(ids)})`).run(info.lastInsertRowid, ...ids);
    return { id: Number(info.lastInsertRowid), expected, amount, diff: round(amount - expected), orders_count: orders.length };
  })();
}

const openingNote = (day) => `رصيد افتتاحي: ما سُلّم حتى ${day} / Solde d’ouverture au ${day}`;

/**
 * بداية التتبع: كل ما سُلّم أو أُرجع قبل التاريخ يُعدّ مسوّى (رصيد افتتاحي)، حتى لا يظهر التاريخ القديم كأنه دَين.
 * سجل واحد لكل شركة، بنوع opening، يمكن حذفه لإعادة فتح طلبياته.
 */
export function openingBalance(projectId, { before, carrier } = {}, { userId } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(before)) ? before : dzDay();
  const endIso = dzDayStartIso(addDays(day, 1));
  const keys = carrier ? [v.oneOf(carrier, CARRIER_KEYS, { name: 'carrier' })] : CARRIER_KEYS;
  return db.transaction(() => {
    const out = [];
    for (const key of keys) {
      const orders = db.prepare(`SELECT * FROM orders WHERE project_id = ? AND carrier = ? AND ${OPEN} AND COALESCE(delivered_at, returned_at, closed_at) < ?`).all(projectId, key, endIso);
      if (!orders.length) continue;
      const expected = round(orders.reduce((a, o) => a + expectedNet(o).net, 0));
      const info = db
        .prepare("INSERT INTO carrier_payouts (project_id, carrier, kind, received_on, amount, expected, orders_count, note, created_by, created_at) VALUES (?, ?, 'opening', ?, ?, ?, ?, ?, ?, ?)")
        .run(projectId, key, day, expected, expected, orders.length, openingNote(day), userId || null, nowIso());
      const ids = orders.map((o) => o.id);
      db.prepare(`UPDATE orders SET payout_id = ? WHERE id IN (${inList(ids)})`).run(info.lastInsertRowid, ...ids);
      out.push({ carrier: key, orders_count: orders.length, expected });
    }
    return out;
  })();
}

export function deletePayout(id) {
  const p = db.prepare('SELECT * FROM carrier_payouts WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'payout_not_found');
  db.transaction(() => {
    db.prepare('UPDATE orders SET payout_id = NULL WHERE payout_id = ?').run(id);
    db.prepare('DELETE FROM carrier_payouts WHERE id = ?').run(id);
  })();
  return p;
}

export const payoutOrders = (id) =>
  db
    .prepare('SELECT * FROM orders WHERE payout_id = ? ORDER BY COALESCE(delivered_at, returned_at, closed_at), id')
    .all(id)
    .map((o) => row(o));
