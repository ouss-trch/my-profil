import { db, parseJson } from '../db/index.js';
import { STATUSES, canTransition, groupOf, SHIPPED_EVER } from '../lib/statuses.js';
import { wilayaByCode, parseWilaya } from '../lib/wilayas.js';
import { HttpError, normalizePhone, nowIso, randomId, round, badRequest, dzDayStartIso, orderNumber, shopifyNumber } from '../lib/util.js';
import { projectConfig } from '../lib/settings.js';
import { inList } from './projects.js';
import { enqueue } from './effects.js';
import { onReturned, onUnreturned, returnView } from './returns.js';
import * as n8n from '../integrations/n8n.js';
import * as shopify from '../integrations/shopify.js';
import * as meta from '../integrations/meta.js';

export function hydrate(row) {
  if (!row) return null;
  const w = wilayaByCode(row.wilaya_code);
  return {
    ...row,
    items: parseJson(row.items, []),
    tags: parseJson(row.tags, []),
    wilaya: w ? { code: w.code, ar: w.ar, fr: w.fr } : null,
  };
}

/**
 * الصفحة التي جاءت منها الطلبية (من رابطها landing_url): صفحة هبوط باسم زاويتها، صفحة المنتج، أو صفحة أخرى؛
 * ونسخة اختبار A/B إن جاءت عبر رابط الاختبار (erp_v).
 */
export function pageOf(url, angles = new Map()) {
  const s = String(url || '');
  if (!s) return null;
  let u;
  try {
    u = new URL(s, 'https://store.invalid');
  } catch {
    return null;
  }
  const view = (u.searchParams.get('view') || '').toLowerCase();
  const [testSlug, testLabel] = String(u.searchParams.get('erp_v') || '').split('.');
  const test = testSlug && /^[A-F]$/.test(testLabel || '') ? { slug: testSlug, label: testLabel } : null;
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* رابط مشوّه: يبقى كما هو */
  }
  path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, '');
  if (view.startsWith('lp-')) return { kind: 'landing', slug: view.slice(3), label: angles.get(view.slice(3)) || view.slice(3), test };
  if (view) return { kind: 'template', label: view, test };
  if (path.startsWith('/products/')) return { kind: 'product', label: null, test };
  return { kind: 'page', label: path, test };
}

/** زوايا صفحات الهبوط (slug ← الزاوية) لتسمية الصفحة في قائمة الطلبيات */
export function landingAngles(projectIds) {
  return new Map(db.prepare(`SELECT slug, angle FROM landing_pages WHERE project_id IN (${inList(projectIds)})`).all(...projectIds).map((r) => [r.slug.toLowerCase(), r.angle]));
}

export function getOrder(id) {
  const o = hydrate(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  if (!o) throw new HttpError(404, 'order_not_found');
  o.page = pageOf(o.landing_url, landingAngles([o.project_id]));
  o.events = db
    .prepare('SELECT e.*, u.display_name AS user_name FROM order_events e LEFT JOIN users u ON u.id = e.user_id WHERE order_id = ? ORDER BY at, id')
    .all(id);
  o.customer = customerSummary(o.phone, o.id);
  o.number = orderNumber(o);
  o.shopify_admin_url = shopify.adminOrderUrl(projectConfig(o.project_id), o.external_id);
  o.return = returnView(o.id);
  return o;
}

export function listOrders({ projectIds, status, statuses, q, wilaya, carrier, from, to, dateField = 'created_at', limit = 50, offset = 0, sort = 'newest', callbackDue }) {
  const where = [`o.project_id IN (${inList(projectIds)})`];
  const args = [...projectIds];
  const st = statuses?.length ? statuses : status ? [status] : null;
  if (st) {
    where.push(`o.status IN (${inList(st)})`);
    args.push(...st);
  } else where.push("o.status != 'abandoned'");
  if (wilaya) {
    where.push('o.wilaya_code = ?');
    args.push(Number(wilaya));
  }
  if (carrier) {
    where.push(carrier === 'none' ? 'o.carrier IS NULL' : 'o.carrier = ?');
    if (carrier !== 'none') args.push(carrier);
  }
  const df = ['created_at', 'confirmed_at', 'shipped_at', 'delivered_at', 'returned_at', 'updated_at'].includes(dateField) ? dateField : 'created_at';
  if (from) {
    where.push(`o.${df} >= ?`);
    args.push(dzDayStartIso(from));
  }
  if (to) {
    where.push(`o.${df} < ?`);
    args.push(dzDayStartIso(to.length === 10 ? new Date(Date.parse(`${to}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10) : to));
  }
  if (callbackDue) {
    where.push("o.status = 'callback' AND (o.callback_at IS NULL OR o.callback_at <= ?)");
    args.push(nowIso());
  }
  if (q) {
    const term = String(q).trim();
    const phone = normalizePhone(term);
    where.push('(o.ref LIKE ? OR o.shopify_name LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ? OR o.tracking LIKE ? OR o.commune LIKE ? OR o.items LIKE ?)');
    const like = `%${term}%`;
    args.push(like, like, like, phone ? `%${phone.slice(1)}%` : like, like, like, like);
  }
  const order = sort === 'oldest' ? 'o.created_at ASC' : sort === 'updated' ? 'o.updated_at DESC' : sort === 'callback' ? 'o.callback_at ASC' : 'o.created_at DESC';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT o.*, p.name AS project_name, p.color AS project_color FROM orders o JOIN projects p ON p.id = o.project_id
       WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...args, Math.min(Number(limit) || 50, 500), Number(offset) || 0);
  const angles = landingAngles(projectIds);
  return { total, rows: rows.map(hydrate).map((o) => ({ ...o, page: pageOf(o.landing_url, angles) })) };
}

export function statusCounts(projectIds) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE project_id IN (${inList(projectIds)}) GROUP BY status`).all(...projectIds);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

function addEvent(orderId, e) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO order_events (order_id, type, from_status, to_status, carrier_status, raw, location, note, source, user_id, at)
       VALUES (@order_id, @type, @from_status, @to_status, @carrier_status, @raw, @location, @note, @source, @user_id, @at)`,
    )
    .run({
      order_id: orderId,
      type: e.type,
      from_status: e.from_status ?? null,
      to_status: e.to_status ?? null,
      carrier_status: e.carrier_status ?? null,
      raw: e.raw ?? null,
      location: e.location ?? null,
      note: e.note ?? null,
      source: e.source ?? 'manual',
      user_id: e.user_id ?? null,
      at: e.at ?? nowIso(),
    });
}
export { addEvent };

const genRef = () => `T${Date.now().toString(36).toUpperCase()}${randomId(2).toUpperCase().replace(/[^A-Z0-9]/g, '7')}`;

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({
      product_id: i.product_id ? Number(i.product_id) : null,
      shopify_product_id: i.shopify_product_id || null,
      variant_id: i.variant_id || null,
      title: String(i.title || '').slice(0, 200),
      variant: String(i.variant || '').slice(0, 120),
      sku: String(i.sku || '').slice(0, 80),
      qty: Math.max(1, Math.min(999, Number(i.qty) || 1)),
      price: Math.max(0, Number(i.price) || 0),
    }))
    .filter((i) => i.title);
}

/** يربط عناصر الطلبية بمنتجات الـ ERP (لحساب التكلفة والأداء حسب المنتج) */
function linkProducts(projectId, items) {
  const byShopify = db.prepare('SELECT id, cost_price FROM products WHERE project_id = ? AND shopify_id = ?');
  const byTitle = db.prepare('SELECT id, cost_price FROM products WHERE project_id = ? AND title = ?');
  for (const i of items) {
    if (i.product_id) continue;
    const p = (i.shopify_product_id && byShopify.get(projectId, i.shopify_product_id)) || byTitle.get(projectId, i.title);
    if (p) i.product_id = p.id;
  }
  return items;
}

function cogsOf(items) {
  const stmt = db.prepare('SELECT cost_price FROM products WHERE id = ?');
  let sum = 0;
  let known = false;
  for (const i of items) {
    const c = i.product_id ? stmt.get(i.product_id)?.cost_price : null;
    if (c) {
      known = true;
      sum += c * i.qty;
    }
  }
  return known ? round(sum) : null;
}

export function createOrder(projectId, input, { source = 'manual', userId = null } = {}) {
  const phone = normalizePhone(input.phone);
  if (!phone && source === 'manual') throw badRequest('phone_invalid');
  const w = parseWilaya(input.wilaya_code ?? input.wilaya);
  const items = linkProducts(projectId, cleanItems(input.items));
  const subtotal = input.subtotal ?? items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = Number(input.discount) || 0;
  const shippingFee = Number(input.shipping_fee) || 0;
  const total = input.total ?? subtotal - discount + shippingFee;
  const ref = input.ref || genRef();
  const existing = db.prepare('SELECT id FROM orders WHERE project_id = ? AND ref = ?').get(projectId, ref);
  if (existing) return { id: existing.id, created: false };
  const now = nowIso();
  const status = STATUSES[input.status] ? input.status : 'new';
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  if (phone && db.prepare('SELECT blacklisted FROM customer_flags WHERE phone = ?').get(phone)?.blacklisted) tags.push('blacklist');
  const info = db
    .prepare(
      `INSERT INTO orders (project_id, ref, source, external_id, shopify_name, status, customer_name, phone, phone2, wilaya_code, commune, commune_fr, address,
        delivery_type, items, subtotal, discount, shipping_fee, total, cogs, notes, tags, utm_source, utm_campaign, utm_content, landing_url, sheet_row, created_at, updated_at, cancelled_at, closed_at)
       VALUES (@project_id, @ref, @source, @external_id, @shopify_name, @status, @customer_name, @phone, @phone2, @wilaya_code, @commune, @commune_fr, @address,
        @delivery_type, @items, @subtotal, @discount, @shipping_fee, @total, @cogs, @notes, @tags, @utm_source, @utm_campaign, @utm_content, @landing_url, @sheet_row, @created_at, @updated_at, @cancelled_at, @closed_at)`,
    )
    .run({
      project_id: projectId,
      ref,
      source,
      external_id: input.external_id || null,
      shopify_name: input.shopify_name || null,
      status,
      customer_name: input.customer_name ? String(input.customer_name).slice(0, 120) : null,
      phone,
      phone2: normalizePhone(input.phone2),
      wilaya_code: w?.code || null,
      commune: input.commune ? String(input.commune).slice(0, 120) : null,
      commune_fr: input.commune_fr ? String(input.commune_fr).slice(0, 120) : null,
      address: input.address ? String(input.address).slice(0, 300) : null,
      delivery_type: input.delivery_type === 'desk' ? 'desk' : 'home',
      items: JSON.stringify(items),
      subtotal: round(subtotal, 2),
      discount: round(discount, 2),
      shipping_fee: round(shippingFee, 2),
      total: round(total, 2),
      cogs: cogsOf(items),
      notes: input.notes ? String(input.notes).slice(0, 2000) : null,
      tags: JSON.stringify([...new Set(tags)]),
      utm_source: input.utm_source || null,
      utm_campaign: input.utm_campaign || null,
      utm_content: input.utm_content ? String(input.utm_content).slice(0, 120) : null,
      landing_url: input.landing_url ? String(input.landing_url).slice(0, 1000) : null,
      sheet_row: input.sheet_row || null,
      created_at: input.created_at || now,
      updated_at: now,
      cancelled_at: status === 'cancelled' ? now : null,
      closed_at: ['cancelled', 'fake'].includes(status) ? now : null,
    });
  addEvent(info.lastInsertRowid, { type: 'created', to_status: status, source, user_id: userId, note: input.offer ? `offer: ${input.offer}` : null, at: input.created_at || now });
  return { id: Number(info.lastInsertRowid), created: true };
}

/** طلبية قادمة من Shopify (بما فيها طلبيات سير COD في n8n) — دمج حسب المعرّف أو المرجع */
export function upsertFromShopify(projectId, parsed) {
  let row = db.prepare('SELECT * FROM orders WHERE project_id = ? AND external_id = ?').get(projectId, parsed.external_id);
  if (!row && parsed.ref) row = db.prepare('SELECT * FROM orders WHERE project_id = ? AND ref = ?').get(projectId, parsed.ref);
  if (!row) {
    const res = createOrder(
      projectId,
      // رقم الطلبية في الـ ERP = رقم Shopify نفسه (إلا إن جاءت بمرجع ERP مسبق من الجدول أو n8n)
      { ...parsed, ref: parsed.ref || shopifyNumber(parsed.shopify_name), commune_fr: null, status: parsed.cancelled ? 'cancelled' : 'new', tags: parsed.tags },
      { source: 'shopify' },
    );
    return { ...res, created: res.created };
  }
  const updates = { external_id: parsed.external_id, shopify_name: parsed.shopify_name };
  // مصدر الزيارة يُستكمل إن كان ناقصاً (طلبيات الجدول لا تحمله دائماً)
  for (const k of ['utm_source', 'utm_campaign', 'utm_content', 'landing_url']) if (!row[k] && parsed[k]) updates[k] = parsed[k];
  // الطلبيات الآتية من الجدول (مثلاً «abandoned» ثم اكتملت) تُستكمل ببيانات Shopify
  if (row.status === 'abandoned' || row.source === 'sheet') {
    Object.assign(updates, {
      items: JSON.stringify(linkProducts(projectId, cleanItems(parsed.items))),
      subtotal: parsed.subtotal,
      discount: parsed.discount,
      shipping_fee: parsed.shipping_fee,
      total: parsed.total,
    });
    if (row.status === 'abandoned') updates.status = 'new';
  }
  const sets = Object.keys(updates).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE orders SET ${sets.join(', ')}, updated_at = @now WHERE id = @id`).run({ ...updates, now: nowIso(), id: row.id });
  if (parsed.cancelled && groupOf(row.status) === 'confirm') changeStatus(row.id, 'cancelled', { source: 'shopify', note: 'cancelled in Shopify', force: true });
  return { id: row.id, created: false };
}

const TIMESTAMP_FOR = { confirmed: 'confirmed_at', delivered: 'delivered_at', returned: 'returned_at', cancelled: 'cancelled_at' };

/**
 * تغيير حالة الطلبية + السجل + الآثار الجانبية (n8n، الجدول، وسوم Shopify، Conversions API)
 * opts: { userId, source, note, force, callbackAt, cancelReason, at, carrierStatus, raw, location }
 */
export function changeStatus(orderId, to, opts = {}) {
  if (!STATUSES[to]) throw badRequest('status_invalid');
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw new HttpError(404, 'order_not_found');
  const from = o.status;
  if (!opts.force && !canTransition(from, to)) throw new HttpError(409, 'transition_not_allowed', 'transition_not_allowed', { from, to });
  const at = opts.at || nowIso();
  const sets = { status: to, updated_at: nowIso() };
  if (to === 'no_answer') sets.call_attempts = (o.call_attempts || 0) + 1;
  if (to === 'callback') sets.callback_at = opts.callbackAt || new Date(Date.now() + 2 * 3600e3).toISOString();
  if (to === 'cancelled' || to === 'fake') sets.cancel_reason = opts.cancelReason || opts.note || o.cancel_reason;
  if (TIMESTAMP_FOR[to] && !o[TIMESTAMP_FOR[to]]) sets[TIMESTAMP_FOR[to]] = at;
  if (groupOf(to) === 'shipping' && !o.shipped_at) sets.shipped_at = at;
  if (to === 'attempt_failed' && from !== 'attempt_failed') sets.delivery_attempts = (o.delivery_attempts || 0) + 1;
  if (['delivered', 'returned', 'cancelled', 'fake'].includes(to)) sets.closed_at = at;
  else if (o.closed_at && !['delivered', 'returned', 'cancelled', 'fake'].includes(to)) sets.closed_at = null;
  if (to === 'delivered' && o.returned_at) sets.returned_at = null;
  if (to === 'returned' && o.delivered_at) sets.delivered_at = null;

  db.transaction(() => {
    const keys = Object.keys(sets);
    db.prepare(`UPDATE orders SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...sets, id: orderId });
    addEvent(orderId, {
      type: from === to ? 'call' : 'status',
      from_status: from,
      to_status: to,
      carrier_status: opts.carrierStatus,
      raw: opts.raw,
      location: opts.location,
      note: opts.note,
      source: opts.source || 'manual',
      user_id: opts.userId,
      at,
    });
  })();

  // المخزون يعود عند وصول الطرد المرتجع إلى البائع، ويُسحب إن صُحّحت الحالة بعدها
  if (to === 'returned' && from !== 'returned') onReturned(orderId, { userId: opts.userId });
  else if (from === 'returned' && to !== 'returned') onUnreturned(orderId, { userId: opts.userId });
  if (from !== to || to === 'no_answer') afterStatusChange({ ...o, ...sets }, from, to, opts);
  return getOrder(orderId);
}

// خريطة الحالات لعمود status في جدول SOU9NA (نفس القيم التي يقرأها التقرير الصباحي في n8n)
export const SHEET_STATUS = {
  abandoned: 'abandoned',
  new: 'created',
  no_answer: 'created',
  callback: 'created',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  fake: 'cancelled',
  shipped: 'shipped',
  in_transit: 'shipped',
  at_office: 'shipped',
  out_for_delivery: 'shipped',
  attempt_failed: 'shipped',
  returning: 'returned',
  delivered: 'delivered',
  returned: 'returned',
};

function afterStatusChange(o, from, to, opts) {
  const cfg = projectConfig(o.project_id);
  const items = parseJson(o.items, []);
  n8n.emit('order.status_changed', { ref: o.ref, number: orderNumber(o), customer_name: o.customer_name, phone: o.phone, total: o.total, from, to }, o.project_id);
  if (to === 'attempt_failed')
    n8n.emit(
      'order.shipment_updated',
      { ref: o.ref, number: orderNumber(o), customer_name: o.customer_name, phone: o.phone, status: 'attempt_failed', raw: opts.raw || '', location: opts.location || '', carrier: o.carrier, tracking: o.tracking },
      o.project_id,
    );

  // كتابة الحالة في جدول Google (عبر جسر n8n) إذا تغيّرت القيمة المقابلة
  if (cfg.sheet_sync && cfg.sheet_id && o.sheet_row && SHEET_STATUS[from] !== SHEET_STATUS[to]) {
    enqueue(`sheet:${o.project_id}`, `sheet status ${o.ref}`, () => writeSheetStatus(cfg, o.sheet_row, SHEET_STATUS[to]));
  }

  // وسوم Shopify (erp-confirmed، erp-delivered…) + تسجيل الدفع عند التسليم
  if (cfg.shopify_tag_orders && o.external_id && shopify.isConfigured(cfg)) {
    enqueue(`shopify:${o.project_id}`, `shopify tags ${o.ref}`, async () => {
      await shopify.removeOrderTags(cfg, o.external_id, [`erp-${from}`]).catch(() => {});
      await shopify.addOrderTags(cfg, o.external_id, [`erp-${to}`]);
      if (to === 'delivered') await shopify.markOrderPaid(cfg, o.external_id).catch((e) => console.warn('[shopify] mark paid', e.message));
    });
  }

  // حدث «سُلّمت» إلى Conversions API: تحسين الإعلانات بالطلبيات المسلّمة فعلاً لا بالنقرات
  if (to === 'delivered' && cfg.meta_capi_delivered && cfg.meta_pixel_id && cfg.meta_access_token) {
    enqueue(`capi:${o.project_id}`, `capi ${o.ref}`, () =>
      meta.sendCapiEvent(cfg, {
        eventName: cfg.meta_capi_event || 'OrderDelivered',
        eventId: `delivered-${o.ref}`,
        value: o.total,
        phone: o.phone,
        firstName: String(o.customer_name || '').split(' ')[0],
        wilaya: wilayaByCode(o.wilaya_code)?.fr,
        contentIds: items.map((i) => (i.shopify_product_id || '').replace(/\D/g, '')).filter(Boolean),
        orderId: o.ref,
      }),
    );
  }
}

async function writeSheetStatus(cfg, rowNumber, value) {
  const headers = await sheetHeaders(cfg);
  const col = headers.indexOf('status');
  if (col < 0) throw new Error('mapping_missing status');
  await n8n.sheetsWrite(cfg.sheet_id, [{ range: `${cfg.sheet_tab}!${colLetter(col)}${rowNumber}`, values: [[value]] }]);
}

const headerCache = new Map();
export async function sheetHeaders(cfg, fresh = false) {
  const key = `${cfg.sheet_id}:${cfg.sheet_tab}`;
  const hit = headerCache.get(key);
  if (!fresh && hit && hit.until > Date.now()) return hit.headers;
  const rows = await n8n.sheetsRead(cfg.sheet_id, `${cfg.sheet_tab}!1:1`);
  const headers = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
  headerCache.set(key, { headers, until: Date.now() + 3600e3 });
  return headers;
}

export function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const EDITABLE = ['customer_name', 'phone', 'phone2', 'wilaya_code', 'commune', 'commune_fr', 'address', 'delivery_type', 'stopdesk_id', 'notes', 'items', 'shipping_fee', 'discount', 'livreur_rating', 'livreur_called', 'assigned_to', 'shipping_cost'];

export function updateOrder(id, input, { userId } = {}) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new HttpError(404, 'order_not_found');
  const sets = {};
  for (const k of EDITABLE) {
    if (input[k] === undefined) continue;
    if (k === 'phone' || k === 'phone2') {
      const p = normalizePhone(input[k]);
      if (input[k] && !p) throw badRequest(`${k}_invalid`);
      sets[k] = p;
    } else if (k === 'wilaya_code') sets[k] = parseWilaya(input[k])?.code || null;
    else if (k === 'delivery_type') sets[k] = input[k] === 'desk' ? 'desk' : 'home';
    else if (k === 'items') sets[k] = JSON.stringify(linkProducts(o.project_id, cleanItems(input.items)));
    else if (['shipping_fee', 'discount', 'shipping_cost'].includes(k)) sets[k] = input[k] === null ? null : Math.max(0, Number(input[k]) || 0);
    else if (k === 'livreur_rating') sets[k] = input[k] === null ? null : Math.max(1, Math.min(5, Number(input[k]) || 0)) || null;
    else if (k === 'livreur_called') sets[k] = input[k] === null ? null : input[k] ? 1 : 0;
    else if (k === 'assigned_to') sets[k] = input[k] ? Number(input[k]) : null;
    else sets[k] = input[k] === null ? null : String(input[k]).slice(0, k === 'notes' ? 2000 : 300);
  }
  if (!Object.keys(sets).length) return getOrder(id);
  if (sets.items || sets.shipping_fee !== undefined || sets.discount !== undefined) {
    if (o.carrier && o.tracking && ['items', 'shipping_fee', 'discount'].some((k) => sets[k] !== undefined)) throw new HttpError(409, 'order_already_shipped');
    const items = sets.items ? JSON.parse(sets.items) : parseJson(o.items, []);
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = sets.shipping_fee ?? o.shipping_fee;
    const disc = sets.discount ?? o.discount;
    Object.assign(sets, { subtotal, total: round(subtotal - disc + fee, 2), cogs: cogsOf(items) });
  }
  sets.updated_at = nowIso();
  db.prepare(`UPDATE orders SET ${Object.keys(sets).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...sets, id });
  const changed = Object.keys(sets).filter((k) => !['updated_at', 'subtotal', 'cogs'].includes(k));
  addEvent(id, { type: 'edit', note: changed.join(', '), user_id: userId });
  return getOrder(id);
}

export function addNote(id, note, userId) {
  if (!db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id)) throw new HttpError(404, 'order_not_found');
  addEvent(id, { type: 'note', note: String(note).slice(0, 2000), user_id: userId });
  return getOrder(id);
}

export function deleteOrder(id) {
  const info = db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  if (!info.changes) throw new HttpError(404, 'order_not_found');
}

// ——— الزبائن ———
export function customerSummary(phone, excludeId = null) {
  if (!phone) return null;
  const rows = db.prepare('SELECT id, status, total, created_at, project_id FROM orders WHERE phone = ?').all(phone);
  const others = rows.filter((r) => r.id !== excludeId);
  const delivered = rows.filter((r) => r.status === 'delivered').length;
  const returned = rows.filter((r) => r.status === 'returned').length;
  const flag = db.prepare('SELECT * FROM customer_flags WHERE phone = ?').get(phone);
  return {
    phone,
    orders: rows.length,
    previous: others.length,
    delivered,
    returned,
    cancelled: rows.filter((r) => ['cancelled', 'fake'].includes(r.status)).length,
    open_duplicates: others.filter((r) => ['new', 'no_answer', 'callback', 'confirmed', 'abandoned'].includes(r.status)).length,
    blacklisted: Boolean(flag?.blacklisted),
    flag_reason: flag?.reason || null,
    risk: riskLevel({ delivered, returned, blacklisted: flag?.blacklisted }),
  };
}

export function riskLevel({ delivered, returned, blacklisted }) {
  if (blacklisted) return 'high';
  if (returned >= 2 && returned > delivered) return 'high';
  if (returned >= 1 && returned >= delivered) return 'medium';
  return 'low';
}

export function listCustomers({ projectIds, q, risk, limit = 100, offset = 0 }) {
  const args = [...projectIds];
  let where = `o.project_id IN (${inList(projectIds)}) AND o.phone IS NOT NULL`;
  if (q) {
    where += ' AND (o.phone LIKE ? OR o.customer_name LIKE ?)';
    args.push(`%${q}%`, `%${q}%`);
  }
  const rows = db
    .prepare(
      `SELECT o.phone, MAX(o.customer_name) AS name, COUNT(*) AS orders,
        SUM(o.status = 'delivered') AS delivered, SUM(o.status = 'returned') AS returned,
        SUM(CASE WHEN o.status = 'delivered' THEN o.total ELSE 0 END) AS revenue,
        MAX(o.created_at) AS last_order, MAX(o.wilaya_code) AS wilaya_code,
        COALESCE(f.blacklisted, 0) AS blacklisted, f.reason AS flag_reason
       FROM orders o LEFT JOIN customer_flags f ON f.phone = o.phone
       WHERE ${where} GROUP BY o.phone ORDER BY last_order DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, Math.min(Number(limit) || 100, 500), Number(offset) || 0)
    .map((r) => ({ ...r, wilaya: wilayaByCode(r.wilaya_code), risk: riskLevel(r) }));
  return risk ? rows.filter((r) => r.risk === risk) : rows;
}

export function setCustomerFlag(phone, { blacklisted, reason, note }) {
  const p = normalizePhone(phone);
  if (!p) throw badRequest('phone_invalid');
  db.prepare(
    `INSERT INTO customer_flags (phone, blacklisted, reason, note, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET blacklisted = excluded.blacklisted, reason = excluded.reason, note = excluded.note, updated_at = excluded.updated_at`,
  ).run(p, blacklisted ? 1 : 0, reason || null, note || null, nowIso());
  return customerSummary(p);
}

export const everShippedSql = `status IN (${SHIPPED_EVER.map((s) => `'${s}'`).join(',')})`;
