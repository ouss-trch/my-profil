import { db, parseJson } from '../db/index.js';
import { CARRIER_KEYS } from '../integrations/carriers/index.js';
import { wilayaByCode } from '../lib/wilayas.js';
import { addDays, badRequest, dzDay, dzDayStartIso, normalizePhone, round, v } from '../lib/util.js';
import { inList } from './projects.js';

// الموردون والشركاء: كل نوع مربوط بعمل فعلي
// supplier ← المنتجات والمخزون (ماذا نطلب ومتى) · delivery ← مكاتب وموزعو شركات التوصيل حسب الولاية (الطرود العالقة)
export const CONTACT_KINDS = ['supplier', 'delivery', 'service', 'wholesale', 'other'];
export const DELIVERY_ROLES = ['desk', 'livreur', 'manager'];
const STUCK = ['at_office', 'attempt_failed'];
const DEFAULT_LEAD_DAYS = 3;
const COVER_DAYS = 14; // الكمية المقترحة تكفي أسبوعين بعد وصول السلعة

export function contactInput(b) {
  const kind = v.oneOf(b.kind || 'supplier', CONTACT_KINDS, { name: 'kind' });
  const out = {
    name: v.str(b.name, { max: 120, required: true, name: 'name' }),
    kind,
    company: v.str(b.company, { max: 120 }),
    phone: b.phone ? normalizePhone(b.phone) || v.str(b.phone, { max: 30 }) : null,
    email: v.str(b.email, { max: 120 }),
    notes: v.str(b.notes, { max: 4000 }),
    project_id: b.project_id ? v.int(b.project_id, { min: 1, name: 'project_id' }) : null,
    carrier: null,
    wilaya_code: null,
    role: null,
    lead_time_days: null,
  };
  if (kind === 'delivery') {
    out.carrier = v.oneOf(b.carrier, CARRIER_KEYS, { required: true, name: 'carrier' });
    out.wilaya_code = v.int(b.wilaya_code, { min: 1, max: 69, name: 'wilaya_code' });
    out.role = v.oneOf(b.role || 'desk', DELIVERY_ROLES, { name: 'role' });
  }
  if (kind === 'supplier') out.lead_time_days = v.int(b.lead_time_days, { min: 0, max: 365, name: 'lead_time_days' });
  return out;
}

/** الكمية المبيعة يومياً لكل منتج (آخر 14 يوماً، دون الملغاة والمزيفة) */
function salesPerDay(projectIds) {
  const since = dzDayStartIso(addDays(dzDay(), -13));
  const rows = db
    .prepare(`SELECT items FROM orders WHERE project_id IN (${inList(projectIds)}) AND created_at >= ? AND status NOT IN ('abandoned','cancelled','fake')`)
    .all(...projectIds, since);
  const qty = {};
  for (const r of rows) for (const i of parseJson(r.items, [])) if (i.product_id) qty[i.product_id] = (qty[i.product_id] || 0) + (Number(i.qty) || 1);
  return Object.fromEntries(Object.entries(qty).map(([k, n]) => [k, n / 14]));
}

/** حالة مخزون منتج عند مورده: هل يجب الطلب الآن وكم */
export function restockPlan(p, perDay, leadDays) {
  const lead = leadDays ?? DEFAULT_LEAD_DAYS;
  const daysLeft = p.stock !== null && perDay > 0 ? p.stock / perDay : null;
  const reorder = p.stock !== null && (p.stock <= (p.low_stock ?? 5) || (daysLeft !== null && daysLeft <= lead + 3));
  const suggested = perDay > 0 ? Math.max(0, Math.ceil(perDay * (lead + COVER_DAYS) - Math.max(0, p.stock || 0))) : null;
  return { per_day: round(perDay, 1), days_left: daysLeft === null ? null : round(daysLeft, 1), reorder, suggested_qty: reorder ? suggested : null };
}

export function listContacts(projectIds, { q = '', kind, carrier, wilaya } = {}) {
  const like = `%${q}%`;
  const where = [`(project_id IS NULL OR project_id IN (${inList(projectIds)}))`, "(name LIKE ? OR COALESCE(phone,'') LIKE ? OR COALESCE(company,'') LIKE ? OR COALESCE(notes,'') LIKE ?)"];
  const args = [...projectIds, like, like, like, like];
  if (kind) {
    where.push('kind = ?');
    args.push(kind);
  }
  if (carrier) {
    where.push('carrier = ?');
    args.push(carrier);
  }
  if (wilaya) {
    // ولايات 2026 (59–69) تُشحن باسم ولايتها الأم: نطابق الاثنين، ومن يغطي كل الولايات
    const w = wilayaByCode(Number(wilaya));
    const codes = [...new Set([Number(wilaya), w?.shipAs].filter(Boolean))];
    where.push(`(wilaya_code IS NULL OR wilaya_code IN (${inList(codes)}))`);
    args.push(...codes);
  }
  const rows = db.prepare(`SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY kind, wilaya_code IS NULL, wilaya_code, name`).all(...args);

  const suppliers = rows.filter((c) => c.kind === 'supplier');
  if (suppliers.length) {
    const perDay = salesPerDay(projectIds);
    const products = db
      .prepare(`SELECT id, title, stock, low_stock, supplier_id, price, cost_price FROM products WHERE stage != 'archived' AND project_id IN (${inList(projectIds)}) AND supplier_id IN (${inList(suppliers.map((s) => s.id))}) ORDER BY title`)
      .all(...projectIds, ...suppliers.map((s) => s.id));
    for (const s of suppliers) {
      s.products = products.filter((p) => p.supplier_id === s.id).map((p) => ({ id: p.id, title: p.title, stock: p.stock, low_stock: p.low_stock, cost_price: p.cost_price, ...restockPlan(p, perDay[p.id] || 0, s.lead_time_days) }));
      s.reorder = s.products.filter((p) => p.reorder);
    }
  }

  const delivery = rows.filter((c) => c.kind === 'delivery');
  if (delivery.length) {
    const stuck = db
      .prepare(`SELECT carrier, wilaya_code, COUNT(*) AS n FROM orders WHERE project_id IN (${inList(projectIds)}) AND status IN (${inList(STUCK)}) GROUP BY carrier, wilaya_code`)
      .all(...projectIds, ...STUCK);
    for (const c of delivery) {
      const covers = (code) => c.wilaya_code === null || c.wilaya_code === code || wilayaByCode(code)?.shipAs === c.wilaya_code;
      c.stuck = stuck.filter((r) => r.carrier === c.carrier && covers(r.wilaya_code)).reduce((s, r) => s + r.n, 0);
    }
  }

  const counts = Object.fromEntries(
    db
      .prepare(`SELECT kind, COUNT(*) AS n FROM contacts WHERE project_id IS NULL OR project_id IN (${inList(projectIds)}) GROUP BY kind`)
      .all(...projectIds)
      .map((r) => [r.kind, r.n]),
  );
  return { rows, counts };
}

/** المورد المرتبط بكل منتج (للمستشار) */
export function suppliersById() {
  return Object.fromEntries(db.prepare("SELECT id, name, phone, lead_time_days FROM contacts WHERE kind = 'supplier'").all().map((c) => [c.id, c]));
}

export function assertSupplier(id) {
  const c = db.prepare('SELECT id, name, kind FROM contacts WHERE id = ?').get(id);
  if (!c || c.kind !== 'supplier') throw badRequest('supplier_invalid');
  return c;
}
