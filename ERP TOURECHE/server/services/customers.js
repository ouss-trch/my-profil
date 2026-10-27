import { db } from '../db/index.js';
import { clamp, fold, round } from '../lib/util.js';
import { wilayaByCode } from '../lib/wilayas.js';
import { inList } from './projects.js';

/**
 * تقييم الزبائن بالدفع عند الاستلام: لا يكفي «مسلّمة أو مرتجعة». من لا يرد عند التأكيد غالباً لا يرد على الموزع أيضاً،
 * فيُحسب لكل زبون «احتمال التسليم المتوقع» من بيانات المتجر نفسه:
 *  1) نسبة التسليم الفعلية في المتجر حسب عدد مرات «لا يرد» قبل التأكيد (0، 1، 2، 3+)، وحسب محاولات التوصيل الفاشلة؛
 *  2) تُدمج مع تاريخ الزبون (مسلّمة/مرتجعة) بتنعيم بايزي، ثم المزيفة، ومن لم يُتوصَّل إليه أبداً، ومن تراجع بعد التأكيد.
 * المستوى والأسباب تظهر في صفحة الزبائن وفي الطلبية نفسها عند التأكيد.
 */

const PRIOR = 10; // وزن القيمة الافتراضية عند قلة بيانات المتجر
const HISTORY = 2; // وزن «المتوقع» مقابل تاريخ الزبون نفسه (طردان مرتجعان من اثنين = خطر)
// قبل أن تتكلم بيانات المتجر: نسبة التسليم تنخفض مع كل «لا يرد» قبل التأكيد ومع كل محاولة توصيل فاشلة
const CALLS_DEFAULT = [1, 0.93, 0.85, 0.75];
const FAILS_DEFAULT = [1, 0.75, 0.55];
// ما تكتبه شركات التوصيل حين لا يأخذ الزبون طرده (بعد إزالة الحركات)
const UNREACHABLE = /injoignable|ne repond pas|repond pas|pas de reponse|client absent|destinataire absent|(telephone|tel|portable|numero) (eteint|ferme)|numero (errone|faux|incorrect|invalide)|ما يردش|لا يرد|مغلق/;
const REFUSED = /refus|rejet|annule par le client|client a annule|رفض/;

// نسب المتجر تتغير ببطء: تُحسب مرة في الدقيقة على الأكثر (فتح الطلبية ومزامنة شركات التوصيل يطلبانها كثيراً)
const LESSONS_TTL = 60e3;
const lessonsCache = new Map();
export function forgetLessons() {
  lessonsCache.clear();
}

/** ماذا تقول بياناتك: نسبة التسليم حسب «لا يرد» قبل التأكيد، وحسب محاولات التوصيل الفاشلة */
export function callLessons(projectIds) {
  const key = [...projectIds].sort((a, b) => a - b).join(',');
  const hit = lessonsCache.get(key);
  if (hit && Date.now() - hit.at < LESSONS_TTL) return hit.value;
  const value = computeLessons(projectIds);
  lessonsCache.set(key, { at: Date.now(), value });
  return value;
}

function computeLessons(projectIds) {
  const rows = db
    .prepare(
      `SELECT MIN(call_attempts, 3) AS c, MIN(delivery_attempts, 2) AS f, COALESCE(SUM(status = 'delivered'), 0) AS d, COALESCE(SUM(status = 'returned'), 0) AS r
       FROM orders WHERE project_id IN (${inList(projectIds)}) AND status IN ('delivered','returned') GROUP BY c, f`,
    )
    .all(...projectIds);
  const d = rows.reduce((sum, x) => sum + x.d, 0);
  const r = rows.reduce((sum, x) => sum + x.r, 0);
  const base = d + r >= 10 ? d / (d + r) : 0.75; // دون بيانات كافية: نسبة شائعة في الجزائر
  const smooth = (dd, rr, prior) => (dd + PRIOR * prior) / (dd + rr + PRIOR);
  const bucket = (key, b) => rows.filter((x) => x[key] === b).reduce((acc, x) => ({ d: acc.d + x.d, r: acc.r + x.r }), { d: 0, r: 0 });
  const byCalls = [0, 1, 2, 3].map((b) => {
    const x = bucket('c', b);
    return { calls: b, delivered: x.d, returned: x.r, rate: round(smooth(x.d, x.r, base * CALLS_DEFAULT[b]), 3) };
  });
  const byFails = [0, 1, 2].map((b) => {
    const x = bucket('f', b);
    return { attempts: b, delivered: x.d, returned: x.r, rate: round(smooth(x.d, x.r, base * FAILS_DEFAULT[b]), 3) };
  });
  // الجدول المشترك («لا يرد» × محاولات فاشلة): الإشارتان مترابطتان (نفس الزبون لا يرد على المؤكد ولا على الموزع)،
  // فضربهما يحسب نفس السلوك مرتين. بيانات الخانة نفسها تصحّح ذلك، والضرب مجرد نقطة بداية حين تقل البيانات.
  const cells = {};
  for (const c of [0, 1, 2, 3])
    for (const f of [0, 1, 2]) {
      const x = rows.find((y) => y.c === c && y.f === f) || { d: 0, r: 0 };
      cells[`${c}:${f}`] = round(smooth(x.d, x.r, byCalls[c].rate * Math.min(1, byFails[f].rate / (byFails[0].rate || 1))), 3);
    }
  return { base: round(base, 3), closed: d + r, byCalls, byFails, cells };
}

/** إحصاءات الزبائن (حسب الهاتف) من كل الطلبيات — phones لقائمة محددة */
function customerStats(projectIds, { phones = null, q = null } = {}) {
  const args = [...projectIds];
  let where = `o.project_id IN (${inList(projectIds)}) AND o.phone IS NOT NULL`;
  if (phones) {
    if (!phones.length) return [];
    where += ` AND o.phone IN (${inList(phones)})`;
    args.push(...phones);
  }
  if (q) {
    where += ' AND (o.phone LIKE ? OR o.customer_name LIKE ?)';
    args.push(`%${q}%`, `%${q}%`);
  }
  const rows = db
    .prepare(
      `SELECT o.phone, MAX(o.customer_name) AS name,
         COALESCE(SUM(o.status != 'abandoned'), 0) AS orders, COALESCE(SUM(o.status = 'abandoned'), 0) AS abandoned,
         COALESCE(SUM(o.status = 'delivered'), 0) AS delivered, COALESCE(SUM(o.status = 'returned'), 0) AS returned,
         COALESCE(SUM(o.status = 'cancelled'), 0) AS cancelled, COALESCE(SUM(o.status = 'fake'), 0) AS fake,
         COALESCE(SUM(o.status = 'cancelled' AND o.confirmed_at IS NOT NULL), 0) AS changed_mind,
         COALESCE(SUM(o.status IN ('cancelled','fake') AND o.confirmed_at IS NULL AND o.call_attempts >= 2), 0) AS unreached,
         COALESCE(SUM(o.call_attempts), 0) AS no_answer_calls, COALESCE(SUM(o.delivery_attempts), 0) AS delivery_failed,
         COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total ELSE 0 END), 0) AS revenue,
         COALESCE(SUM(o.status IN ('new','no_answer','callback','confirmed')), 0) AS open,
         MAX(o.created_at) AS last_order, MIN(o.created_at) AS first_order, MAX(o.wilaya_code) AS wilaya_code,
         COALESCE(MAX(f.blacklisted), 0) AS blacklisted, MAX(f.reason) AS flag_reason
       FROM orders o LEFT JOIN customer_flags f ON f.phone = o.phone
       WHERE ${where} GROUP BY o.phone ORDER BY last_order DESC`,
    )
    .all(...args);
  if (!rows.length) return rows;
  // ما كتبته شركة التوصيل: رفض الاستلام، أو الزبون لا يرد/مغلق (طرود مختلفة لكل زبون)
  const list = rows.map((r) => r.phone);
  const carrier = new Map();
  const events = db
    .prepare(
      `SELECT o.phone, e.order_id, COALESCE(e.raw, e.carrier_status, '') AS raw FROM order_events e JOIN orders o ON o.id = e.order_id
       WHERE o.project_id IN (${inList(projectIds)}) AND o.phone IN (${inList(list)}) AND e.type = 'carrier'`,
    )
    .all(...projectIds, ...list);
  for (const e of events) {
    const text = fold(e.raw);
    const c = carrier.get(e.phone) || { unreachable: new Set(), refused: new Set() };
    if (UNREACHABLE.test(text)) c.unreachable.add(e.order_id);
    if (REFUSED.test(text)) c.refused.add(e.order_id);
    carrier.set(e.phone, c);
  }
  const callbacks = new Map(
    db
      .prepare(`SELECT o.phone, COUNT(*) AS n FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.project_id IN (${inList(projectIds)}) AND o.phone IN (${inList(list)}) AND e.to_status = 'callback' GROUP BY o.phone`)
      .all(...projectIds, ...list)
      .map((x) => [x.phone, x.n]),
  );
  return rows.map((r) => ({
    ...r,
    callbacks: callbacks.get(r.phone) || 0,
    carrier_unreachable: carrier.get(r.phone)?.unreachable.size || 0,
    refused: carrier.get(r.phone)?.refused.size || 0,
  }));
}

/**
 * التقييم: احتمال التسليم المتوقع + المستوى + الأسباب (بالأرقام) + اقتراح عملي للمؤكِّد.
 * high = خطر، medium = متوسط، low = عادي، trusted = موثوق، new = جديد بلا تاريخ.
 */
export function assess(s, lessons) {
  if (s.blacklisted) return { level: 'high', p_deliver: 0, score: 100, reasons: [{ code: 'blacklisted' }], advice: 'blacklisted' };
  const reasons = [];
  const base = lessons.base;
  const perOrder = (n) => (s.orders ? Math.round(n / s.orders) : 0);
  // المتوقع لزبون يتصرف هكذا: نسبة المتجر لمن لم يرد بنفس العدد وفشل توصيله بنفس العدد
  // (فشل المحاولة وما كتبه الموزع «لا يرد/مغلق» يصفان غالباً نفس الطرد: يؤخذ الأكبر لا المجموع)
  const c = Math.min(3, perOrder(s.no_answer_calls));
  const fails = Math.max(s.delivery_failed, s.carrier_unreachable);
  const f = Math.min(2, perOrder(fails) || (fails ? 1 : 0));
  let prior = lessons.cells?.[`${c}:${f}`];
  if (prior === undefined) {
    prior = lessons.byCalls[c]?.rate ?? base;
    if (f) prior *= clamp((lessons.byFails[f]?.rate ?? base) / (lessons.byFails[0]?.rate || base || 1), 0.3, 1);
  }
  let p = (s.delivered + HISTORY * prior) / (s.delivered + s.returned + HISTORY);
  if (s.fake) p *= 0.5 ** s.fake;
  if (s.unreached) p *= 0.85 ** Math.min(3, s.unreached); // طلبيات أُلغيت لأنه لم يرد أبداً
  if (s.changed_mind >= 2) p *= 0.9;
  p = clamp(p, 0, 0.99);
  if (s.delivered) reasons.push({ code: 'delivered', n: s.delivered, good: true });
  if (s.returned) reasons.push({ code: 'returned', n: s.returned });
  if (s.refused) reasons.push({ code: 'refused', n: s.refused });
  if (s.fake) reasons.push({ code: 'fake', n: s.fake });
  if (s.no_answer_calls >= 2) reasons.push({ code: 'no_answer', n: s.no_answer_calls });
  if (s.unreached) reasons.push({ code: 'unreached', n: s.unreached });
  if (s.delivery_failed) reasons.push({ code: 'delivery_failed', n: s.delivery_failed });
  if (s.carrier_unreachable) reasons.push({ code: 'courier_no_answer', n: s.carrier_unreachable });
  if (s.changed_mind) reasons.push({ code: 'changed_mind', n: s.changed_mind });
  if (s.open > 1) reasons.push({ code: 'duplicates', n: s.open });
  let level;
  if (s.fake || p < Math.min(0.5, base * 0.7)) level = 'high';
  else if (p < base * 0.9) level = 'medium';
  // موثوق: استلم وما أرجع، ولم يُتعبنا (فشل التوصيل أقل من مرات الاستلام) واحتماله فوق متوسط المتجر
  else if (s.delivered && !s.returned && !s.unreached && fails < s.delivered && p >= base) level = 'trusted';
  else if (!s.delivered && !s.returned && s.no_answer_calls < 2 && !fails && !s.unreached && !s.changed_mind) level = 'new';
  else level = 'low';
  // اقتراح للمؤكِّد: الخطر والمتوسط ← تأكيد أقوى أو المكتب؛ الموثوق ← بلا تعقيد
  const advice = level === 'high' ? (s.returned || s.refused ? 'deposit_or_desk' : s.fake ? 'fake_before' : 'confirm_twice') : level === 'medium' ? 'confirm_twice' : level === 'trusted' ? 'fast_track' : null;
  return { level, p_deliver: round(p * 100), score: round(100 * (1 - p)), reasons, advice };
}

/** قائمة الزبائن بالتقييم — risk يصفّي على المستوى، sort: risk | recent | value */
export function listCustomerProfiles(projectIds, { q, risk, sort = 'recent', limit = 100, offset = 0 } = {}) {
  const lessons = callLessons(projectIds);
  let rows = customerStats(projectIds, { q }).map((s) => {
    const a = assess(s, lessons);
    return { ...s, wilaya: wilayaByCode(s.wilaya_code), ...a, risk: a.level };
  });
  // العدّادات على كل الزبائن (قبل التصفية بالمستوى) حتى تبقى بطاقات الصفحة ثابتة
  const counts = countLevels(rows);
  const all = rows.length;
  const repeat = rows.filter((r) => r.delivered >= 2).length;
  if (risk) rows = rows.filter((r) => r.level === risk);
  if (sort === 'risk') rows.sort((a, b) => b.score - a.score || b.orders - a.orders);
  if (sort === 'value') rows.sort((a, b) => b.revenue - a.revenue);
  const n = Math.min(Number(limit) || 100, 500);
  const off = Number(offset) || 0;
  return { lessons, all, total: rows.length, counts, repeat, rows: rows.slice(off, off + n) };
}

function countLevels(rows) {
  const out = { high: 0, medium: 0, low: 0, trusted: 0, new: 0 };
  for (const r of rows) out[r.level]++;
  return out;
}

/** زبون واحد (الطلبية والمؤكِّد): نفس التقييم بكل طلبياته في كل المشاريع */
export function customerProfile(phone) {
  if (!phone) return null;
  const projectIds = db.prepare('SELECT DISTINCT project_id FROM orders WHERE phone = ?').all(phone).map((r) => r.project_id);
  if (!projectIds.length) return null;
  const [s] = customerStats(projectIds, { phones: [phone] });
  if (!s) return null;
  return { ...s, ...assess(s, callLessons(projectIds)) };
}
