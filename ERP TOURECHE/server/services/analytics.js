import { db, parseJson } from '../db/index.js';
import { getSetting, projectConfig } from '../lib/settings.js';
import { CONFIRM_PENDING, SHIPPING_ACTIVE, SHIPPED_EVER } from '../lib/statuses.js';
import { WILAYAS, wilayaByCode } from '../lib/wilayas.js';
import { addDays, clamp, daysBetween, dzDay, dzDayStartIso, median, nowIso, round } from '../lib/util.js';
import { CARRIERS } from '../integrations/carriers/index.js';
import { inList } from './projects.js';
import { tariff } from './shipments.js';
import { returnCost as returnCostOf, returnsByOrder } from './returns.js';

const q = (list) => list.map((s) => `'${s}'`).join(',');
const CONFIRMED_EVER = q(['confirmed', ...SHIPPED_EVER]);
const HANDLED = q(['confirmed', ...SHIPPED_EVER, 'cancelled', 'fake']);

/** تحويل إنفاق الإعلانات إلى الدينار حسب أسعار الصرف في الإعدادات (السوق الموازي) */
export function toDa(amount, currency) {
  const c = String(currency || 'DZD').toUpperCase();
  if (c === 'DZD') return amount;
  if (c === 'USD') return amount * (getSetting('fx_usd_dza') || 250);
  if (c === 'EUR') return amount * (getSetting('fx_eur_dza') || 270);
  return amount * (getSetting('fx_usd_dza') || 250);
}

export function adSpendDa(projectIds, fromDay, toDay) {
  const rows = db
    .prepare(`SELECT currency, SUM(spend) AS spend, SUM(purchases) AS purchases FROM ad_spend WHERE project_id IN (${inList(projectIds)}) AND date >= ? AND date <= ? GROUP BY currency`)
    .all(...projectIds, fromDay, toDay);
  return {
    spend_da: round(rows.reduce((s, r) => s + toDa(r.spend, r.currency), 0)),
    purchases: rows.reduce((s, r) => s + r.purchases, 0),
    by_currency: rows.map((r) => ({ currency: r.currency, spend: round(r.spend, 2) })),
  };
}

function rates(projectIds) {
  const since14 = dzDayStartIso(addDays(dzDay(), -13));
  const since30 = dzDayStartIso(addDays(dzDay(), -29));
  const c = db
    .prepare(
      `SELECT SUM(status IN (${CONFIRMED_EVER})) AS confirmed, SUM(status IN (${HANDLED})) AS handled
       FROM orders WHERE project_id IN (${inList(projectIds)}) AND created_at >= ? AND status != 'abandoned'`,
    )
    .get(...projectIds, since14);
  const d = db
    .prepare(
      `SELECT SUM(status = 'delivered') AS delivered, SUM(status = 'returned') AS returned
       FROM orders WHERE project_id IN (${inList(projectIds)}) AND closed_at >= ? AND status IN ('delivered','returned')`,
    )
    .get(...projectIds, since30);
  return {
    confirmation_rate_14d: c.handled ? round((100 * c.confirmed) / c.handled) : null,
    delivery_rate_30d: d.delivered + d.returned ? round((100 * d.delivered) / (d.delivered + d.returned)) : null,
  };
}

/** لوحة «اليوم» */
export function today(projectIds) {
  const day = dzDay();
  const start = dzDayStartIso(day);
  const P = inList(projectIds);
  const one = (sql, ...args) => db.prepare(sql).get(...projectIds, ...args);
  const created = one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS v FROM orders WHERE project_id IN (${P}) AND created_at >= ? AND status != 'abandoned'`, start);
  const abandoned = one(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND created_at >= ? AND status = 'abandoned'`, start);
  const confirmedToday = one(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND confirmed_at >= ?`, start);
  const shippedToday = one(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND shipped_at >= ?`, start);
  const delivered = one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS v FROM orders WHERE project_id IN (${P}) AND status = 'delivered' AND delivered_at >= ?`, start);
  const returned = one(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND status = 'returned' AND returned_at >= ?`, start);
  const callbacksDue = one(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND status = 'callback' AND (callback_at IS NULL OR callback_at <= ?)`, nowIso());
  const counts = Object.fromEntries(
    db.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE project_id IN (${P}) GROUP BY status`).all(...projectIds).map((r) => [r.status, r.n]),
  );
  const sum = (keys) => keys.reduce((s, k) => s + (counts[k] || 0), 0);
  const ads = adSpendDa(projectIds, day, day);

  // آخر 14 يوماً
  const series = [];
  const from = addDays(day, -13);
  const byDay = (col, extra = '') =>
    Object.fromEntries(
      db
        .prepare(
          `SELECT date(${col}, '+1 hour') AS d, COUNT(*) AS n, COALESCE(SUM(total),0) AS v FROM orders
           WHERE project_id IN (${P}) AND ${col} >= ? ${extra} GROUP BY d`,
        )
        .all(...projectIds, dzDayStartIso(from))
        .map((r) => [r.d, r]),
    );
  const createdBy = byDay('created_at', "AND status != 'abandoned'");
  const confirmedBy = byDay('confirmed_at');
  const deliveredBy = byDay('delivered_at', "AND status = 'delivered'");
  const returnedBy = byDay('returned_at', "AND status = 'returned'");
  const spendRows = db
    .prepare(`SELECT date, currency, SUM(spend) AS s FROM ad_spend WHERE project_id IN (${P}) AND date >= ? GROUP BY date, currency`)
    .all(...projectIds, from);
  const spendBy = {};
  for (const r of spendRows) spendBy[r.date] = (spendBy[r.date] || 0) + toDa(r.s, r.currency);
  for (let i = 0; i < 14; i++) {
    const d = addDays(from, i);
    series.push({
      day: d,
      orders: createdBy[d]?.n || 0,
      confirmed: confirmedBy[d]?.n || 0,
      delivered: deliveredBy[d]?.n || 0,
      returned: returnedBy[d]?.n || 0,
      revenue: round(deliveredBy[d]?.v || 0),
      ad_spend_da: round(spendBy[d] || 0),
    });
  }

  const lowStock = db
    .prepare(`SELECT id, project_id, title, stock, low_stock FROM products WHERE project_id IN (${P}) AND stage != 'archived' AND stock IS NOT NULL AND stock <= low_stock ORDER BY stock LIMIT 10`)
    .all(...projectIds);

  const topProducts = topProductsSince(projectIds, start, 5);

  return {
    day,
    orders_today: created.n,
    orders_value_today: round(created.v),
    abandoned_today: abandoned.n,
    confirmed_today: confirmedToday.n,
    shipped_today: shippedToday.n,
    delivered_today: delivered.n,
    delivered_value_today: round(delivered.v),
    returned_today: returned.n,
    pending_confirmation: sum(CONFIRM_PENDING),
    abandoned_open: counts.abandoned || 0,
    callbacks_due: callbacksDue.n,
    to_ship: counts.confirmed || 0,
    in_delivery: sum(SHIPPING_ACTIVE),
    out_for_delivery: counts.out_for_delivery || 0,
    attempt_failed: counts.attempt_failed || 0,
    returning: counts.returning || 0,
    pipeline: {
      new: counts.new || 0,
      no_answer: counts.no_answer || 0,
      callback: counts.callback || 0,
      confirmed: counts.confirmed || 0,
      shipped: (counts.shipped || 0) + (counts.in_transit || 0),
      at_office: counts.at_office || 0,
      out_for_delivery: counts.out_for_delivery || 0,
      attempt_failed: counts.attempt_failed || 0,
      returning: counts.returning || 0,
    },
    ad_spend_today_da: ads.spend_da,
    cpa_today_da: created.n ? round(ads.spend_da / created.n) : null,
    ...rates(projectIds),
    series,
    low_stock: lowStock,
    top_products: topProducts,
  };
}

function topProductsSince(projectIds, sinceIso, limit = 10) {
  const rows = db
    .prepare(`SELECT items, status FROM orders WHERE project_id IN (${inList(projectIds)}) AND created_at >= ? AND status != 'abandoned'`)
    .all(...projectIds, sinceIso);
  const m = new Map();
  for (const r of rows)
    for (const i of parseJson(r.items, [])) {
      const k = i.title;
      const cur = m.get(k) || { title: k, product_id: i.product_id || null, qty: 0, orders: 0 };
      cur.qty += i.qty;
      cur.orders += 1;
      m.set(k, cur);
    }
  return [...m.values()].sort((a, b) => b.orders - a.orders).slice(0, limit);
}

/** الإحصاءات لفترة: سلسلة يومية، القمع، الولايات، المنتجات، الربح التقديري، أداء الموظفين */
export function stats(projectIds, fromDay, toDay) {
  const P = inList(projectIds);
  const startIso = dzDayStartIso(fromDay);
  const endIso = dzDayStartIso(addDays(toDay, 1));
  const orders = db
    .prepare(`SELECT * FROM orders WHERE project_id IN (${P}) AND created_at >= ? AND created_at < ? AND status != 'abandoned'`)
    .all(...projectIds, startIso, endIso);
  const closed = db
    .prepare(`SELECT * FROM orders WHERE project_id IN (${P}) AND closed_at >= ? AND closed_at < ? AND status IN ('delivered','returned')`)
    .all(...projectIds, startIso, endIso);

  const funnel = {
    orders: orders.length,
    confirmed: orders.filter((o) => ['confirmed', ...SHIPPED_EVER].includes(o.status)).length,
    cancelled: orders.filter((o) => ['cancelled', 'fake'].includes(o.status)).length,
    pending: orders.filter((o) => CONFIRM_PENDING.includes(o.status)).length,
    shipped: orders.filter((o) => SHIPPED_EVER.includes(o.status)).length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    returned: orders.filter((o) => o.status === 'returned').length,
    in_delivery: orders.filter((o) => SHIPPING_ACTIVE.includes(o.status)).length,
  };
  const handled = funnel.confirmed + funnel.cancelled;
  const deliveredC = closed.filter((o) => o.status === 'delivered');
  const returnedC = closed.filter((o) => o.status === 'returned');

  const revenue = deliveredC.reduce((s, o) => s + o.total, 0);
  const cogs = deliveredC.reduce((s, o) => s + (o.cogs || 0), 0);
  const shipCost = deliveredC.reduce((s, o) => s + (o.shipping_cost || 0), 0);
  // كلفة المرتجع الحقيقية: سعر الإرجاع + التغليف الضائع + البضاعة التالفة أو المفقودة (من دفتر المرتجعات)
  const retRows = returnsByOrder(returnedC.map((o) => o.id));
  const retCosts = returnedC.map((o) => returnCostOf(o, retRows.get(o.id)));
  const returnCost = retCosts.reduce((s, c) => s + c.total, 0);
  const returnGoodsLost = retCosts.reduce((s, c) => s + c.goods, 0);
  const ads = adSpendDa(projectIds, fromDay, toDay);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE project_id IN (${P}) AND date >= ? AND date <= ?`).get(...projectIds, fromDay, toDay).s;

  // السلسلة اليومية
  const days = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) days.push(d);
  const dayOf = (iso) => (iso ? dzDay(iso) : null);
  const series = days.map((d) => ({ day: d, orders: 0, confirmed: 0, delivered: 0, returned: 0, revenue: 0, ad_spend_da: 0 }));
  const idx = Object.fromEntries(days.map((d, i) => [d, i]));
  for (const o of orders) {
    const i = idx[dayOf(o.created_at)];
    if (i !== undefined) series[i].orders++;
  }
  for (const o of db.prepare(`SELECT confirmed_at FROM orders WHERE project_id IN (${P}) AND confirmed_at >= ? AND confirmed_at < ?`).all(...projectIds, startIso, endIso)) {
    const i = idx[dayOf(o.confirmed_at)];
    if (i !== undefined) series[i].confirmed++;
  }
  for (const o of closed) {
    const i = idx[dayOf(o.closed_at)];
    if (i === undefined) continue;
    if (o.status === 'delivered') {
      series[i].delivered++;
      series[i].revenue += o.total;
    } else series[i].returned++;
  }
  for (const r of db.prepare(`SELECT date, currency, SUM(spend) AS s FROM ad_spend WHERE project_id IN (${P}) AND date >= ? AND date <= ? GROUP BY date, currency`).all(...projectIds, fromDay, toDay)) {
    const i = idx[r.date];
    if (i !== undefined) series[i].ad_spend_da += round(toDa(r.s, r.currency));
  }

  // الولايات
  const byW = new Map();
  for (const o of orders) {
    const w = byW.get(o.wilaya_code) || { wilaya_code: o.wilaya_code, orders: 0, confirmed: 0, delivered: 0, returned: 0, revenue: 0 };
    w.orders++;
    if (['confirmed', ...SHIPPED_EVER].includes(o.status)) w.confirmed++;
    if (o.status === 'delivered') {
      w.delivered++;
      w.revenue += o.total;
    }
    if (o.status === 'returned') w.returned++;
    byW.set(o.wilaya_code, w);
  }
  const wilayas = [...byW.values()]
    .map((w) => ({ ...w, wilaya: wilayaByCode(w.wilaya_code), delivery_rate: w.delivered + w.returned ? round((100 * w.delivered) / (w.delivered + w.returned)) : null }))
    .sort((a, b) => b.orders - a.orders);

  // المنتجات
  const byP = new Map();
  for (const o of orders)
    for (const i of parseJson(o.items, [])) {
      const k = i.product_id || i.title;
      const p = byP.get(k) || { product_id: i.product_id || null, title: i.title, orders: 0, qty: 0, confirmed: 0, delivered: 0, returned: 0, revenue: 0 };
      p.orders++;
      p.qty += i.qty;
      if (['confirmed', ...SHIPPED_EVER].includes(o.status)) p.confirmed++;
      if (o.status === 'delivered') {
        p.delivered++;
        p.revenue += i.price * i.qty;
      }
      if (o.status === 'returned') p.returned++;
      byP.set(k, p);
    }
  const products = [...byP.values()].sort((a, b) => b.orders - a.orders);

  // أداء الموظفين في التأكيد
  const agents = db
    .prepare(
      `SELECT u.id, u.display_name, u.username,
         SUM(e.to_status = 'confirmed') AS confirmed, SUM(e.to_status IN ('cancelled','fake')) AS cancelled,
         SUM(e.to_status = 'no_answer') AS no_answer, COUNT(*) AS actions
       FROM order_events e JOIN users u ON u.id = e.user_id JOIN orders o ON o.id = e.order_id
       WHERE o.project_id IN (${P}) AND e.at >= ? AND e.at < ? AND e.type IN ('status','call')
       GROUP BY u.id ORDER BY confirmed DESC`,
    )
    .all(...projectIds, startIso, endIso);

  const sources = Object.values(
    orders.reduce((m, o) => {
      const k = o.utm_source || o.source || 'direct';
      m[k] ||= { source: k, orders: 0, delivered: 0 };
      m[k].orders++;
      if (o.status === 'delivered') m[k].delivered++;
      return m;
    }, {}),
  ).sort((a, b) => b.orders - a.orders);

  const profit = revenue - cogs - shipCost - returnCost - ads.spend_da - expenses;
  return {
    from: fromDay,
    to: toDay,
    funnel,
    confirmation_rate: handled ? round((100 * funnel.confirmed) / handled) : null,
    delivery_rate: deliveredC.length + returnedC.length ? round((100 * deliveredC.length) / (deliveredC.length + returnedC.length)) : null,
    finance: {
      revenue: round(revenue),
      cogs: round(cogs),
      shipping_cost: round(shipCost),
      return_cost: round(returnCost),
      return_goods_lost: round(returnGoodsLost),
      ad_spend_da: ads.spend_da,
      expenses: round(expenses),
      profit: round(profit),
      cpa: funnel.orders ? round(ads.spend_da / funnel.orders) : null,
      cost_per_delivered: deliveredC.length ? round(ads.spend_da / deliveredC.length) : null,
      avg_basket: deliveredC.length ? round(revenue / deliveredC.length) : null,
    },
    series: series.map((s) => ({ ...s, revenue: round(s.revenue) })),
    wilayas,
    products,
    agents,
    sources,
  };
}

// ————————————————————————————————————————————————
// أداء شركات التوصيل حسب الولاية + اقتراح أفضل شركة لكل ولاية
// ————————————————————————————————————————————————
const PRIOR_WEIGHT = 8; // عدد طرود «افتراضي» يُدمج مع البيانات القليلة (تنعيم بايزي)

function emptyAgg() {
  return { shipped: 0, delivered: 0, returned: 0, in_progress: 0, days: [], attempts_total: 0, with_attempt: 0, returned_no_attempt: 0, called_yes: 0, called_total: 0, ratings: [] };
}

function addRow(agg, r) {
  agg.shipped++;
  if (r.status === 'delivered') {
    agg.delivered++;
    const d = daysBetween(r.shipped_at, r.delivered_at);
    if (d !== null && d >= 0 && d < 60) agg.days.push(d);
  } else if (r.status === 'returned') {
    agg.returned++;
    if (!r.delivery_attempts) agg.returned_no_attempt++;
  } else agg.in_progress++;
  if (r.delivery_attempts > 0) agg.with_attempt++;
  agg.attempts_total += r.delivery_attempts || 0;
  if (r.livreur_called !== null && r.livreur_called !== undefined) {
    agg.called_total++;
    if (r.livreur_called) agg.called_yes++;
  }
  if (r.livreur_rating) agg.ratings.push(r.livreur_rating);
}

function metrics(agg) {
  const closed = agg.delivered + agg.returned;
  const avgDays = agg.days.length ? agg.days.reduce((s, x) => s + x, 0) / agg.days.length : null;
  return {
    shipped: agg.shipped,
    closed,
    delivered: agg.delivered,
    returned: agg.returned,
    in_progress: agg.in_progress,
    success_rate: closed ? agg.delivered / closed : null,
    avg_days: avgDays,
    median_days: median(agg.days),
    attempt_rate: agg.shipped ? agg.with_attempt / agg.shipped : null,
    // نسبة المرتجعات دون أي محاولة اتصال من الموزع (مؤشر سلبي على جدية الموزع)
    no_attempt_return_rate: agg.returned ? agg.returned_no_attempt / agg.returned : null,
    // من يحاول الوصول للزبون: طلبيات سُلّمت أو أُرجعت بعد محاولة واحدة على الأقل
    contact_rate: closed ? (agg.delivered + (agg.returned - agg.returned_no_attempt)) / closed : null,
    called_rate: agg.called_total ? agg.called_yes / agg.called_total : null,
    rating: agg.ratings.length ? agg.ratings.reduce((s, x) => s + x, 0) / agg.ratings.length : null,
  };
}

const smooth = (value, n, prior) => (value === null || value === undefined ? prior : (value * n + prior * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT));
const speedScore = (days) => (days === null ? 0.5 : clamp((7 - days) / 6, 0, 1));
const confidence = (n) => (n >= 25 ? 'high' : n >= 8 ? 'medium' : n >= 1 ? 'low' : 'none');

function loadShipments(projectIds, windowDays) {
  return db
    .prepare(
      `SELECT project_id, carrier, wilaya_code, delivery_type, status, shipped_at, delivered_at, returned_at, delivery_attempts, livreur_called, livreur_rating
       FROM orders WHERE project_id IN (${inList(projectIds)}) AND carrier IS NOT NULL AND shipped_at >= ?`,
    )
    .all(...projectIds, new Date(Date.now() - windowDays * 86400e3).toISOString());
}

export function carrierPerformance(projectIds, { windowDays } = {}) {
  const win = windowDays || getSetting('carrier_window_days') || 120;
  const rows = loadShipments(projectIds, win);
  const overall = {};
  const perWilaya = {};
  const all = emptyAgg();
  for (const r of rows) {
    addRow((overall[r.carrier] ||= emptyAgg()), r);
    addRow(((perWilaya[r.wilaya_code] ||= {})[r.carrier] ||= emptyAgg()), r);
    addRow(all, r);
  }
  const carriers = Object.keys(CARRIERS).map((key) => ({ carrier: key, name: CARRIERS[key].name, ...metrics(overall[key] || emptyAgg()) }));
  const wilayas = Object.entries(perWilaya).map(([code, byCarrier]) => ({
    wilaya_code: Number(code),
    wilaya: wilayaByCode(code),
    carriers: Object.entries(byCarrier).map(([key, agg]) => ({ carrier: key, ...metrics(agg) })),
  }));
  return { window_days: win, total: metrics(all), carriers, wilayas };
}

/**
 * ترتيب الشركات لولاية ونوع توصيل: نسبة التسليم (45%) + السرعة (25%) + جدية الموزع في الاتصال (15%) + السعر (15%)
 * البيانات القليلة تُدمج مع متوسط الشركة العام (تنعيم بايزي) حتى لا تخدعنا 2–3 طرود.
 */
export function recommendCarrier(projectIds, wilayaCode, deliveryType = 'home', { windowDays, rows: preloaded } = {}) {
  const weights = { success: 0.45, speed: 0.25, contact: 0.15, cost: 0.15, ...(getSetting('carrier_weights') || {}) };
  const win = windowDays || getSetting('carrier_window_days') || 120;
  const rows = preloaded || loadShipments(projectIds, win);
  const overall = {};
  const local = {};
  const global = emptyAgg();
  for (const r of rows) {
    addRow((overall[r.carrier] ||= emptyAgg()), r);
    addRow(global, r);
    if (Number(r.wilaya_code) === Number(wilayaCode)) addRow((local[r.carrier] ||= emptyAgg()), r);
  }
  const g = metrics(global);
  const projectId = projectIds[0];
  const cfg = projectConfig(projectId);
  const candidates = Object.keys(CARRIERS).filter((k) => CARRIERS[k].isConfigured(cfg) || overall[k] || local[k]);
  const fees = Object.fromEntries(candidates.map((k) => [k, tariff(projectId, k, wilayaCode, deliveryType)?.fee ?? null]));
  const knownFees = Object.values(fees).filter((f) => f > 0);
  const minFee = knownFees.length ? Math.min(...knownFees) : null;

  const ranked = candidates.map((key) => {
    const o = metrics(overall[key] || emptyAgg());
    const l = metrics(local[key] || emptyAgg());
    const priorSuccess = o.success_rate ?? g.success_rate ?? 0.7;
    const priorDays = o.avg_days ?? g.avg_days ?? 3;
    const priorContact = o.contact_rate ?? g.contact_rate ?? 0.8;
    const success = smooth(l.success_rate, l.closed, priorSuccess);
    const days = smooth(l.avg_days, l.delivered, priorDays);
    let contact = smooth(l.contact_rate, l.closed, priorContact);
    if (l.called_rate !== null) contact = 0.5 * contact + 0.5 * l.called_rate;
    if (l.rating !== null) contact = 0.7 * contact + 0.3 * ((l.rating - 1) / 4);
    const fee = fees[key];
    const cost = fee && minFee ? minFee / fee : 0.5;
    const score = weights.success * success + weights.speed * speedScore(days) + weights.contact * contact + weights.cost * cost;
    return {
      carrier: key,
      name: CARRIERS[key].name,
      configured: CARRIERS[key].isConfigured(cfg),
      score: round(score * 100),
      confidence: confidence(l.closed),
      local: l,
      overall: o,
      estimated: { success_rate: round(success * 100), avg_days: round(days, 1), contact_rate: round(contact * 100) },
      fee,
    };
  });
  ranked.sort((a, b) => b.score - a.score || (b.configured ? 1 : 0) - (a.configured ? 1 : 0));
  return { wilaya: wilayaByCode(wilayaCode), delivery_type: deliveryType, weights, window_days: win, ranked, best: ranked[0]?.carrier || null };
}

/** أفضل شركة لكل ولاية (69) — لخريطة/جدول القرار */
export function bestByWilaya(projectIds, deliveryType = 'home') {
  const rows = loadShipments(projectIds, getSetting('carrier_window_days') || 120);
  return WILAYAS.map((w) => {
    const r = recommendCarrier(projectIds, w.code, deliveryType, { rows });
    const top = r.ranked[0];
    return {
      wilaya: { code: w.code, ar: w.ar, fr: w.fr },
      best: top?.carrier || null,
      score: top?.score ?? null,
      confidence: top?.confidence || 'none',
      shipped: r.ranked.reduce((s, x) => s + x.local.shipped, 0),
      ranked: r.ranked.map((x) => ({ carrier: x.carrier, score: x.score, success: x.estimated.success_rate, days: x.estimated.avg_days, n: x.local.closed })),
    };
  });
}
