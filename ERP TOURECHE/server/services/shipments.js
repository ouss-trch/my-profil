import { db, parseJson } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { normalizeCarrierStatus, SHIPPING_ACTIVE, SHIPPING_RANK, STATUSES } from '../lib/statuses.js';
import { shippingWilaya, wilayaByCode } from '../lib/wilayas.js';
import { HttpError, nowIso, badRequest } from '../lib/util.js';
import { carrier as getCarrier, CARRIERS } from '../integrations/carriers/index.js';
import { changeStatus, getOrder, addEvent } from './orders.js';
import { inList } from './projects.js';

export function configuredCarriers(projectId) {
  const cfg = projectConfig(projectId);
  return Object.entries(CARRIERS).map(([key, c]) => ({ key, name: c.name, configured: c.isConfigured(cfg) }));
}

export function tariff(projectId, carrierKey, wilayaCode, deliveryType = 'home') {
  const ship = shippingWilaya(wilayaCode) || wilayaCode;
  const row =
    db.prepare('SELECT * FROM carrier_tariffs WHERE project_id = ? AND carrier = ? AND wilaya_code = ?').get(projectId, carrierKey, ship) ||
    db.prepare('SELECT * FROM carrier_tariffs WHERE project_id = 0 AND carrier = ? AND wilaya_code = ?').get(carrierKey, ship);
  if (!row) return null;
  return { fee: deliveryType === 'desk' ? row.desk_fee : row.home_fee, return_fee: row.return_fee };
}

/** إرسال طلبية مؤكدة إلى شركة التوصيل وإنشاء رقم التتبع */
export async function sendToCarrier(orderId, { carrier, commune, stopdesk_id, delivery_type, note, weight } = {}, { userId } = {}) {
  const o = getOrder(orderId);
  if (o.tracking) throw new HttpError(409, 'already_shipped');
  if (o.status !== 'confirmed') throw new HttpError(409, 'order_not_confirmed');
  const cfg = projectConfig(o.project_id);
  const key = carrier || cfg.default_carrier;
  if (!key || !CARRIERS[key]) throw badRequest('carrier_required');
  const adapter = getCarrier(key);
  if (!adapter.isConfigured(cfg)) throw new HttpError(400, 'carrier_not_configured');
  if (!o.phone) throw badRequest('phone_invalid');
  if (!o.wilaya_code) throw badRequest('wilaya_required');
  const dType = delivery_type || o.delivery_type;
  const payload = {
    ref: o.ref,
    customer_name: o.customer_name,
    phone: o.phone,
    phone2: o.phone2,
    wilaya_code: shippingWilaya(o.wilaya_code),
    commune: commune || o.commune_fr || o.commune,
    address: o.address,
    delivery_type: dType,
    stopdesk_id: stopdesk_id || o.stopdesk_id,
    items: o.items,
    total: o.total,
    note: note || '',
    weight,
  };
  const res = await adapter.create(cfg, payload);
  const t = tariff(o.project_id, key, o.wilaya_code, dType);
  db.prepare(
    `UPDATE orders SET carrier = ?, tracking = ?, label_url = ?, delivery_type = ?, stopdesk_id = ?, commune_fr = COALESCE(?, commune_fr),
       shipping_cost = COALESCE(shipping_cost, ?), carrier_status = 'shipped', carrier_synced_at = ?, updated_at = ? WHERE id = ?`,
  ).run(key, res.tracking, res.label_url, dType, stopdesk_id || o.stopdesk_id || null, commune || null, t?.fee ?? null, nowIso(), nowIso(), orderId);
  return changeStatus(orderId, 'shipped', { userId, source: 'carrier', note: `${adapter.name} · ${res.tracking}`, force: true });
}

/** ربط يدوي برقم تتبع موجود (طرد أنشئ من لوحة الشركة مباشرة) */
export function attachTracking(orderId, { carrier, tracking }, { userId } = {}) {
  if (!CARRIERS[carrier]) throw badRequest('carrier_invalid');
  if (!tracking) throw badRequest('tracking_required');
  const o = getOrder(orderId);
  const t = tariff(o.project_id, carrier, o.wilaya_code, o.delivery_type);
  db.prepare('UPDATE orders SET carrier = ?, tracking = ?, shipping_cost = COALESCE(shipping_cost, ?), updated_at = ? WHERE id = ?').run(carrier, String(tracking).trim(), t?.fee ?? null, nowIso(), orderId);
  if (['confirmed', 'new', 'no_answer', 'callback'].includes(o.status)) return changeStatus(orderId, 'shipped', { userId, source: 'manual', force: true, note: `${carrier} · ${tracking}` });
  return getOrder(orderId);
}

/** تطبيق سجل أحداث شركة التوصيل على طلبية */
export function applyCarrierHistory(order, carrierKey, info) {
  const events = (info.events || []).filter((e) => e.raw).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let latest = null;
  let attempts = 0;
  let lastAttemptAt = null;
  for (const e of events) {
    const status = normalizeCarrierStatus(carrierKey, e.raw, e.key);
    if (!e.at) {
      // شركة لا تعطي تاريخ الحدث: نسجله مرة واحدة عند تغيّر الحالة فقط
      if (e.raw === order.carrier_status_raw) {
        if (status) latest = { ...e, status, at: order.carrier_synced_at || nowIso() };
        continue;
      }
      e.at = nowIso();
    }
    addEvent(order.id, { type: 'carrier', carrier_status: status, raw: e.raw, location: e.location || null, note: e.reason || null, source: 'carrier', at: e.at || nowIso() });
    if (status === 'attempt_failed' && e.at !== lastAttemptAt) {
      attempts++;
      lastAttemptAt = e.at;
    }
    if (status) latest = { ...e, status };
  }
  attempts = Math.max(attempts, Number.isFinite(info.attempts) ? info.attempts : 0, order.delivery_attempts || 0);
  const lastRaw = events.at(-1)?.raw || order.carrier_status_raw;
  db.prepare('UPDATE orders SET carrier_status = ?, carrier_status_raw = ?, carrier_synced_at = ?, delivery_attempts = ? WHERE id = ?').run(
    latest?.status || order.carrier_status,
    lastRaw,
    nowIso(),
    attempts,
    order.id,
  );
  if (!latest || latest.status === order.status || !STATUSES[latest.status]) return false;
  const cur = SHIPPING_RANK[order.status] ?? 0;
  const next = SHIPPING_RANK[latest.status] ?? 0;
  const terminal = ['delivered', 'returned'].includes(order.status);
  // لا رجوع إلى مرحلة أقدم، إلا بين «محاولة فاشلة» و«خرجت للتوصيل/المكتب» (محاولة جديدة)
  const retry = order.status === 'attempt_failed' && ['out_for_delivery', 'at_office'].includes(latest.status);
  if (latest.status === 'cancelled') return false;
  if ((next < cur && !retry) || (terminal && next <= cur && latest.at <= (order.closed_at || ''))) return false;
  changeStatus(order.id, latest.status, { source: 'carrier', force: true, at: latest.at || nowIso(), raw: latest.raw, location: latest.location, carrierStatus: latest.status });
  return true;
}

/** مزامنة التتبع لكل الطرود النشطة في مشروع */
export async function syncTracking(projectId, { orderIds } = {}) {
  const cfg = projectConfig(projectId);
  const where = orderIds?.length
    ? `id IN (${inList(orderIds)})`
    : `status IN (${inList(SHIPPING_ACTIVE)}) AND shipped_at >= datetime('now', '-75 days')`;
  const rows = db
    .prepare(`SELECT * FROM orders WHERE project_id = ? AND carrier IS NOT NULL AND tracking IS NOT NULL AND ${where}`)
    .all(projectId, ...(orderIds?.length ? orderIds : SHIPPING_ACTIVE));
  const byCarrier = {};
  for (const r of rows) (byCarrier[r.carrier] ||= []).push(r);
  const result = { checked: rows.length, changed: 0, errors: [] };
  for (const [key, orders] of Object.entries(byCarrier)) {
    const adapter = CARRIERS[key];
    if (!adapter?.isConfigured(cfg)) continue;
    try {
      const map = await adapter.track(cfg, orders.map((o) => o.tracking));
      for (const o of orders) {
        const info = map.get(o.tracking);
        if (info && applyCarrierHistory(o, key, info)) result.changed++;
      }
    } catch (e) {
      result.errors.push({ carrier: key, error: e.message, kind: e.kind });
      if (e.kind === 'network' || e.kind === 'auth') throw e;
    }
  }
  return result;
}

export async function refreshTariffs(projectId) {
  const cfg = projectConfig(projectId);
  const out = {};
  for (const [key, adapter] of Object.entries(CARRIERS)) {
    if (!adapter.isConfigured(cfg)) continue;
    try {
      const fees = await adapter.fees(cfg);
      const stmt = db.prepare(
        `INSERT INTO carrier_tariffs (project_id, carrier, wilaya_code, home_fee, desk_fee, return_fee, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, carrier, wilaya_code) DO UPDATE SET home_fee = excluded.home_fee, desk_fee = excluded.desk_fee, return_fee = excluded.return_fee, updated_at = excluded.updated_at`,
      );
      db.transaction(() => {
        for (const f of fees) if (f.wilaya_code) stmt.run(projectId, key, f.wilaya_code, f.home_fee, f.desk_fee, f.return_fee, nowIso());
      })();
      out[key] = fees.length;
    } catch (e) {
      out[key] = { error: e.message };
    }
  }
  return out;
}

export function setTariff(projectId, carrierKey, wilayaCode, { home_fee, desk_fee, return_fee }) {
  if (!CARRIERS[carrierKey]) throw badRequest('carrier_invalid');
  if (!wilayaByCode(wilayaCode)) throw badRequest('wilaya_invalid');
  db.prepare(
    `INSERT INTO carrier_tariffs (project_id, carrier, wilaya_code, home_fee, desk_fee, return_fee, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, carrier, wilaya_code) DO UPDATE SET home_fee = excluded.home_fee, desk_fee = excluded.desk_fee, return_fee = excluded.return_fee, updated_at = excluded.updated_at`,
  ).run(projectId, carrierKey, Number(wilayaCode), home_fee ?? null, desk_fee ?? null, return_fee ?? null, nowIso());
}

export const tariffs = (projectId) =>
  db.prepare('SELECT * FROM carrier_tariffs WHERE project_id IN (0, ?) ORDER BY carrier, wilaya_code').all(projectId);

export function itemsSummary(order) {
  return parseJson(order.items, [])
    .map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} ×${i.qty}`)
    .join('، ');
}
