import crypto from 'node:crypto';
import { db, parseJson } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { HttpError, addDays, badRequest, dzDay, dzDayStartIso, nowIso, orderNumber, round } from '../lib/util.js';
import * as shopify from '../integrations/shopify.js';
import { enqueue } from './effects.js';
import { inList } from './projects.js';
import { tariff } from './shipments.js';

/**
 * المرتجعات: «المخزون يعود إلى حيث خُصم».
 *  - طلبية Shopify: Shopify خصم الكمية عند الطلب ⇒ تُعاد إلى «المتاح» في Shopify، ونسخة الـ ERP تتحرك فوراً.
 *  - طلبية لم تمر بـ Shopify: لم يُخصم شيء عند البيع ⇒ لا شيء يُعاد (وإلا تضخم المخزون).
 * لكل سطر: كم عاد صالحاً (back)، والباقي تالف أو مفقود (loss) يُحسب خسارةً بسعر التكلفة.
 * التزامن مع Shopify «حتى الهدف»: الهدف = ما يجب أن يكون قد أُعيد، والمطبَّق = ما أُرسل فعلاً؛ يُرسل الفرق فقط،
 * بمفتاح @idempotent ثابت لكل انتقال، فإعادة المحاولة بعد انقطاع لا تكرر التعديل.
 */
const LOSS = ['damaged', 'missing'];
const isShopifyOrder = (o) => /^gid:\/\/shopify\/Order\/\d+$/.test(String(o.external_id || ''));
const productStmt = () => db.prepare('SELECT id, cost_price, packaging_cost FROM products WHERE id = ?');

function snapshot(o) {
  const linked = isShopifyOrder(o);
  const product = productStmt();
  return parseJson(o.items, []).map((i, idx) => {
    const p = i.product_id ? product.get(i.product_id) : null;
    return {
      idx,
      product_id: i.product_id || null,
      variant_id: i.variant_id || null,
      title: i.title,
      variant: i.variant || '',
      qty: i.qty,
      back: i.qty,
      loss: null,
      unit_cost: p?.cost_price ?? null,
      packaging: p?.packaging_cost || 0,
      // لماذا لا يعود هذا السطر إلى مخزون: لم يُخصم عند البيع، أو سطر بلا variant في Shopify، أو مخزون غير متتبَّع
      why: !linked ? 'not_deducted' : !i.variant_id ? 'no_variant' : null,
    };
  });
}

const restockOf = (r, i) => (r.state === 'open' && !i.why ? i.back : 0);

function costs(r, items) {
  if (r.state !== 'open') return { goods_lost: 0, packaging_lost: 0 };
  return {
    goods_lost: round(items.reduce((a, i) => a + (i.qty - i.back) * (i.unit_cost || 0), 0)),
    packaging_lost: round(items.reduce((a, i) => a + (i.packaging || 0), 0)),
  };
}

const getRow = (id) => db.prepare('SELECT * FROM order_returns WHERE id = ?').get(id);
export const returnOf = (orderId) => db.prepare('SELECT * FROM order_returns WHERE order_id = ?').get(orderId) || null;

/** نسخة الـ ERP: حركة مخزون لكل منتج بقدر الفرق بين الهدف وما سُجّل سابقاً لهذه الطلبية */
function syncLocal(r, items, userId) {
  const applied = db.prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE order_id = ? AND product_id = ? AND reason LIKE 'return%'");
  const target = new Map();
  for (const i of items) if (i.product_id) target.set(i.product_id, (target.get(i.product_id) || 0) + restockOf(r, i));
  for (const [productId, want] of target) {
    if (!productStmt().get(productId)) continue;
    const delta = want - applied.get(r.order_id, productId).n;
    if (!delta) continue;
    db.prepare('UPDATE products SET stock = COALESCE(stock, 0) + ?, updated_at = ? WHERE id = ?').run(delta, nowIso(), productId);
    db.prepare('INSERT INTO stock_movements (project_id, product_id, delta, reason, order_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      r.project_id,
      productId,
      delta,
      delta > 0 ? 'return' : 'return_correction',
      r.order_id,
      userId || null,
      nowIso(),
    );
  }
}

function save(r, items, extra = {}) {
  const next = { ...r, ...extra };
  const c = costs(next, items);
  const needsShopify = items.some((i) => !i.why) && isShopifyOrder(db.prepare('SELECT external_id FROM orders WHERE id = ?').get(r.order_id));
  db.prepare(
    `UPDATE order_returns SET state = @state, items = @items, goods_lost = @goods_lost, packaging_lost = @packaging_lost, note = @note,
       shopify_state = @shopify_state, shopify_attempts = @shopify_attempts, updated_by = @updated_by, updated_at = @now WHERE id = @id`,
  ).run({
    id: r.id,
    state: next.state,
    items: JSON.stringify(items),
    ...c,
    note: next.note ?? null,
    shopify_state: needsShopify ? 'pending' : 'skipped',
    shopify_attempts: needsShopify ? 0 : r.shopify_attempts,
    updated_by: next.updated_by ?? r.updated_by ?? null,
    now: nowIso(),
  });
  return getRow(r.id);
}

const queueShopify = (r) => r.shopify_state === 'pending' && enqueue(`shopify:${r.project_id}`, `restock ${r.order_id}`, () => syncShopify(r.id));

/** تُستدعى عند دخول الطلبية حالة «مرتجعة» (من شركة التوصيل أو يدوياً) */
export function onReturned(orderId, { userId, alreadyRestocked = false } = {}) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  let r = returnOf(orderId);
  db.transaction(() => {
    if (!r) {
      const items = snapshot(o);
      const fee = o.carrier ? (tariff(o.project_id, o.carrier, o.wilaya_code, o.delivery_type)?.return_fee ?? null) : null;
      const info = db
        .prepare("INSERT INTO order_returns (project_id, order_id, state, items, return_fee, shopify_state, updated_by, created_at, updated_at) VALUES (?, ?, 'open', ?, ?, 'skipped', ?, ?, ?)")
        .run(o.project_id, o.id, JSON.stringify(items), fee, userId || null, nowIso(), nowIso());
      r = save(getRow(info.lastInsertRowid), items);
      if (alreadyRestocked) {
        // أُعيدت يدوياً قبل هذا السجل: نسجّلها للتكاليف دون لمس أي مخزون
        const done = Object.fromEntries(items.filter((i) => !i.why).map((i) => [i.variant_id, restockOf(r, i)]));
        db.prepare("UPDATE order_returns SET shopify_state = 'done', shopify_applied = ?, note = ? WHERE id = ?").run(JSON.stringify(done), 'restocked manually before tracking', r.id);
        r = getRow(r.id);
        // الحركة تُسجَّل (حتى تُحسب التصحيحات اللاحقة من الصفر الصحيح) دون تغيير رقم المخزون: هو أصلاً يتضمنها
        for (const i of items)
          if (i.product_id && restockOf(r, i))
            db.prepare("INSERT INTO stock_movements (project_id, product_id, delta, reason, order_id, user_id, at) VALUES (?, ?, ?, 'return (manual, before tracking)', ?, ?, ?)").run(o.project_id, i.product_id, restockOf(r, i), o.id, userId || null, nowIso());
        return;
      }
    } else if (r.state === 'reversed') r = save(r, parseJson(r.items, []), { state: 'open' });
    else return;
    syncLocal(r, parseJson(r.items, []), userId);
  })();
  queueShopify(r);
  return returnOf(orderId);
}

/** خرجت الطلبية من «مرتجعة» (تصحيح: سُلّمت في النهاية): يُسحب ما أُعيد */
export function onUnreturned(orderId, { userId } = {}) {
  let r = returnOf(orderId);
  if (!r || r.state === 'reversed') return r;
  db.transaction(() => {
    r = save(r, parseJson(r.items, []), { state: 'reversed' });
    syncLocal(r, parseJson(r.items, []), userId);
  })();
  queueShopify(r);
  return returnOf(orderId);
}

/** حالة كل سطر بعد فتح الطرد: كم عاد صالحاً، والباقي تالف أو مفقود */
export function updateReturn(id, { items: changes, note }, { userId } = {}) {
  const r = getRow(id);
  if (!r) throw new HttpError(404, 'return_not_found');
  if (r.state !== 'open') throw badRequest('return_reversed');
  const items = parseJson(r.items, []);
  for (const ch of Array.isArray(changes) ? changes : []) {
    const i = items.find((x) => x.idx === Number(ch.idx));
    if (!i) throw badRequest('return_item_invalid');
    const back = Number(ch.back);
    if (!Number.isInteger(back) || back < 0 || back > i.qty) throw badRequest('return_qty_invalid');
    if (back < i.qty && !LOSS.includes(ch.loss)) throw badRequest('return_loss_required');
    i.back = back;
    i.loss = back < i.qty ? ch.loss : null;
  }
  let out;
  db.transaction(() => {
    out = save(r, items, { note: note === undefined ? r.note : String(note || '').slice(0, 500) || null, updated_by: userId });
    syncLocal(out, items, userId);
  })();
  queueShopify(out);
  return returnOf(r.order_id);
}

const keyOf = (s) => {
  const h = crypto.createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** إرسال الفرق إلى Shopify. آمن لإعادة المحاولة: المطبَّق يُحفظ بعد كل مجموعة، والمفتاح ثابت لكل انتقال */
export async function syncShopify(id) {
  let r = getRow(id);
  if (!r || !['pending', 'failed'].includes(r.shopify_state)) return r;
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(r.order_id);
  const cfg = projectConfig(r.project_id);
  const fail = (msg) => db.prepare("UPDATE order_returns SET shopify_state = 'failed', shopify_error = ?, shopify_attempts = shopify_attempts + 1, updated_at = ? WHERE id = ?").run(String(msg).slice(0, 300), nowIso(), id);
  if (!shopify.isConfigured(cfg)) {
    fail('shopify_not_configured');
    return getRow(id);
  }
  try {
    const items = parseJson(r.items, []);
    const applied = parseJson(r.shopify_applied, {});
    const target = {};
    for (const i of items) if (!i.why) target[i.variant_id] = (target[i.variant_id] || 0) + restockOf(r, i);
    const pending = [...new Set([...Object.keys(target), ...Object.keys(applied)])].filter((vid) => (target[vid] || 0) !== (applied[vid] || 0));
    if (pending.length) {
      const t = await shopify.restockTargets(cfg, o.external_id, pending);
      if (!t.locationId) throw new Error('shopify_location_missing');
      const groups = {};
      for (const vid of pending) {
        const inv = t.items[vid];
        const line = items.find((i) => i.variant_id === vid);
        if (!inv?.inventoryItemId || !inv.tracked) {
          // مخزون غير متتبَّع في Shopify: لا شيء يُعدَّل هناك
          for (const i of items) if (i.variant_id === vid) i.why = 'untracked';
          continue;
        }
        const delta = (target[vid] || 0) - (applied[vid] || 0);
        const reason = delta > 0 ? 'restock' : r.state !== 'open' ? 'correction' : line?.loss === 'missing' ? 'shrinkage' : line?.loss === 'damaged' ? 'damaged' : 'correction';
        (groups[reason] ||= []).push({ vid, inventoryItemId: inv.inventoryItemId, delta, from: applied[vid] || 0, to: target[vid] || 0 });
      }
      db.prepare('UPDATE order_returns SET items = ? WHERE id = ?').run(JSON.stringify(items), id);
      for (const [reason, changes] of Object.entries(groups)) {
        const key = keyOf(`erp-return:${id}:${reason}:${changes.map((c) => `${c.vid}:${c.from}->${c.to}`).join('|')}`);
        await shopify.adjustAvailable(cfg, { locationId: t.locationId, changes, reason, reference: o.external_id, key });
        for (const c of changes) applied[c.vid] = c.to;
        db.prepare('UPDATE order_returns SET shopify_applied = ? WHERE id = ?').run(JSON.stringify(applied), id);
      }
    }
    db.prepare("UPDATE order_returns SET shopify_state = 'done', shopify_error = NULL, shopify_synced_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  } catch (e) {
    fail(e.message || e);
  }
  return getRow(id);
}

/** المهمة الدورية: الجديدة كل 5 دقائق، والفاشلة كل 30 دقيقة حتى 20 محاولة */
export async function retryShopify(projectId, { includeFailed = false } = {}) {
  const states = includeFailed ? ['pending', 'failed'] : ['pending'];
  const rows = db.prepare(`SELECT id FROM order_returns WHERE project_id = ? AND shopify_state IN (${inList(states)}) AND shopify_attempts < 20 ORDER BY id LIMIT 50`).all(projectId, ...states);
  let done = 0;
  for (const { id } of rows) if ((await syncShopify(id))?.shopify_state === 'done') done++;
  return { tried: rows.length, done, failed: rows.length - done };
}

export function retryNow(id) {
  const r = getRow(id);
  if (!r) throw new HttpError(404, 'return_not_found');
  db.prepare("UPDATE order_returns SET shopify_state = 'pending', shopify_attempts = 0 WHERE id = ? AND shopify_state = 'failed'").run(id);
  return syncShopify(id);
}

// ——— التكاليف: ما يكلّفه الطرد المرتجع فعلاً ———
/** خريطة order_id → سجل الإرجاع (لحلقات المالية والإعلانات) */
export function returnsByOrder(orderIds) {
  if (!orderIds.length) return new Map();
  return new Map(db.prepare(`SELECT * FROM order_returns WHERE order_id IN (${inList(orderIds)})`).all(...orderIds).map((r) => [r.order_id, r]));
}

/**
 * كلفة طرد مرتجع = سعر الإرجاع + التغليف الضائع + البضاعة التالفة أو المفقودة (بسعر التكلفة).
 * مرتجعة قديمة بلا سجل: سعر الإرجاع + التغليف (البضاعة تُفترض عادت).
 */
export function returnCost(o, r, { fallbackFee = 0 } = {}) {
  if (r?.state === 'open') {
    // سعر الإرجاع غير معروف عند التسجيل (الأسعار لم تُحدَّث بعد): يُقرأ من الأسعار الحالية
    const fee = r.return_fee ?? ((o.carrier && tariff(o.project_id, o.carrier, o.wilaya_code, o.delivery_type)?.return_fee) || fallbackFee);
    return { fee, packaging: r.packaging_lost, goods: r.goods_lost, total: round(fee + r.packaging_lost + r.goods_lost) };
  }
  const fee = (o.carrier && tariff(o.project_id, o.carrier, o.wilaya_code, o.delivery_type)?.return_fee) || fallbackFee;
  const product = productStmt();
  const packaging = parseJson(o.items, []).reduce((a, i) => a + ((i.product_id && product.get(i.product_id)?.packaging_cost) || 0), 0);
  return { fee, packaging: round(packaging), goods: 0, total: round(fee + packaging) };
}

/** نسبة الوحدات التي ترجع تالفة أو مفقودة (90 يوماً) — تدخل في حد التعادل */
export function lossRate(projectId) {
  const rows = db
    .prepare("SELECT items FROM order_returns WHERE project_id = ? AND state = 'open' AND created_at >= ?")
    .all(projectId, dzDayStartIso(addDays(dzDay(), -89)));
  let units = 0;
  let lost = 0;
  for (const r of rows)
    for (const i of parseJson(r.items, [])) {
      units += i.qty;
      lost += i.qty - i.back;
    }
  return units >= 10 ? lost / units : 0;
}

// ——— القوائم ———
const view = (r) => (r ? { ...r, items: parseJson(r.items, []).map((i) => ({ ...i, restock: restockOf(r, i) })), shopify_applied: parseJson(r.shopify_applied, {}) } : null);
export const returnView = (orderId) => view(returnOf(orderId));

export function summary(projectIds) {
  const P = inList(projectIds);
  const count = (sql, ...a) => db.prepare(sql).get(...projectIds, ...a).n;
  return {
    pending: count(`SELECT COUNT(*) AS n FROM order_returns WHERE project_id IN (${P}) AND shopify_state = 'pending'`),
    failed: count(`SELECT COUNT(*) AS n FROM order_returns WHERE project_id IN (${P}) AND shopify_state = 'failed'`),
    last_error: db.prepare(`SELECT shopify_error FROM order_returns WHERE project_id IN (${P}) AND shopify_state = 'failed' ORDER BY updated_at DESC LIMIT 1`).get(...projectIds)?.shopify_error || null,
    legacy: count(`SELECT COUNT(*) AS n FROM orders o WHERE o.project_id IN (${P}) AND o.status = 'returned' AND NOT EXISTS (SELECT 1 FROM order_returns r WHERE r.order_id = o.id)`),
    lost_30d: round(
      db.prepare(`SELECT COALESCE(SUM(goods_lost), 0) AS v FROM order_returns WHERE project_id IN (${P}) AND state = 'open' AND created_at >= ?`).get(...projectIds, dzDayStartIso(addDays(dzDay(), -29))).v,
    ),
  };
}

/** مرتجعات سبقت هذا الدفتر: يقرر صاحب المتجر هل أُعيدت يدوياً أم تُعاد الآن */
export function legacyReturns(projectIds) {
  return db
    .prepare(
      `SELECT o.* FROM orders o WHERE o.project_id IN (${inList(projectIds)}) AND o.status = 'returned' AND NOT EXISTS (SELECT 1 FROM order_returns r WHERE r.order_id = o.id)
       ORDER BY COALESCE(o.returned_at, o.closed_at) DESC LIMIT 500`,
    )
    .all(...projectIds)
    .map((o) => ({ id: o.id, number: orderNumber(o), customer_name: o.customer_name, returned_at: o.returned_at || o.closed_at, items: parseJson(o.items, []).map((i) => `${i.qty}× ${i.title}`).join('، '), shopify: isShopifyOrder(o) }));
}

export function processLegacy(projectIds, orderIds, { alreadyRestocked, userId } = {}) {
  const ids = [...new Set((orderIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw badRequest('orders_required');
  const rows = db.prepare(`SELECT id FROM orders WHERE id IN (${inList(ids)}) AND project_id IN (${inList(projectIds)}) AND status = 'returned'`).all(...ids, ...projectIds);
  let done = 0;
  for (const { id } of rows) {
    if (returnOf(id)) continue;
    onReturned(id, { userId, alreadyRestocked: Boolean(alreadyRestocked) });
    done++;
  }
  return { processed: done };
}
