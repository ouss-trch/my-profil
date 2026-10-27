import { db } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { addDays, badRequest, dzDay, dzDayStartIso, notFound, nowIso, round, v } from '../lib/util.js';
import * as shopify from '../integrations/shopify.js';
import { getProject, inList } from './projects.js';

/**
 * صفحات المتجر: كل صفحة تُعرف بمسارها (والنسخة ?view= إن وُجدت) فتُربط بالطلبيات عبر landing_url،
 * وباختبارات A/B، وبالمنتج. المزامنة لا تمسّ التثبيت ولا الملاحظات.
 */
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const LOCALE = /^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i;

function parse(url, base) {
  try {
    const u = new URL(url, base || 'https://store.invalid');
    const path = decode(u.pathname).replace(LOCALE, '').replace(/\/+$/, '') || '/';
    const view = u.searchParams.get('view');
    return { u, path, key: `${path.toLowerCase()}${view ? `?view=${view.toLowerCase()}` : ''}` };
  } catch {
    return null;
  }
}

export function storeBase(projectId) {
  const d = projectConfig(projectId).store_domain || getProject(projectId)?.domain;
  return d ? `https://${String(d).replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : null;
}

const canonical = (u) => {
  u.hash = '';
  return u.href;
};

function upsertSynced(projectId, row) {
  db.prepare(
    `INSERT INTO store_pages (project_id, kind, url, path, title, shopify_id, template_suffix, published, gone, product_id, synced_at)
     VALUES (@project_id, @kind, @url, @path, @title, @shopify_id, @template_suffix, @published, 0, @product_id, @now)
     ON CONFLICT(project_id, url) DO UPDATE SET kind = excluded.kind, title = excluded.title, shopify_id = excluded.shopify_id, template_suffix = excluded.template_suffix,
       published = excluded.published, gone = 0, product_id = COALESCE(store_pages.product_id, excluded.product_id), synced_at = excluded.synced_at`,
  ).run({ project_id: projectId, now: nowIso(), shopify_id: null, template_suffix: null, product_id: null, ...row });
}

/** مزامنة صفحات Shopify + صفحات المنتجات؛ صفحة حُذفت من المتجر: تُحذف إن لم تكن مثبتة، وتُعلَّم «محذوفة» إن كانت مثبتة */
export async function syncPages(projectId) {
  const base = storeBase(projectId);
  if (!base) throw badRequest('store_domain_required');
  const cfg = projectConfig(projectId);
  const seen = [];
  // صفحات المعلومات (من نحن، الأسئلة الشائعة…) ثانوية: إن نقصت صلاحية read_online_store_pages
  // تُترك كما هي ولا تتوقف صفحات المنتجات، وهي التي تُنسب إليها الطلبيات واختبارات A/B
  let shopifyPages = null;
  if (shopify.isConfigured(cfg)) {
    try {
      shopifyPages = await shopify.listPages(cfg);
    } catch (e) {
      if (!/access_denied/.test(e.message)) throw e;
    }
    for (const p of shopifyPages || []) {
      const { u, path } = parse(`/pages/${p.handle}`, base);
      const url = canonical(u);
      upsertSynced(projectId, { kind: 'page', url, path, title: p.title, shopify_id: p.id, template_suffix: p.templateSuffix || null, published: p.isPublished ? 1 : 0 });
      seen.push(url);
    }
  }
  for (const p of db.prepare("SELECT id, title, handle, stage, shopify_id FROM products WHERE project_id = ? AND handle IS NOT NULL AND handle != '' AND stage != 'archived'").all(projectId)) {
    const { u, path } = parse(`/products/${p.handle}`, base);
    const url = canonical(u);
    upsertSynced(projectId, { kind: 'product', url, path, title: p.title, shopify_id: p.shopify_id, published: p.stage === 'published' ? 1 : 0, product_id: p.id });
    seen.push(url);
  }
  // المضافة يدوياً (synced_at فارغ) لا تُعدّ محذوفة أبداً
  const stale = db
    .prepare(`SELECT id, pinned FROM store_pages WHERE project_id = ? AND synced_at IS NOT NULL ${shopifyPages ? '' : "AND kind != 'page'"} ${seen.length ? `AND url NOT IN (${inList(seen)})` : ''}`)
    .all(projectId, ...seen);
  for (const s of stale) {
    if (s.pinned) db.prepare('UPDATE store_pages SET gone = 1 WHERE id = ?').run(s.id);
    else db.prepare('DELETE FROM store_pages WHERE id = ?').run(s.id);
  }
  const out = { synced: seen.length, removed: stale.filter((s) => !s.pinned).length, gone: stale.filter((s) => s.pinned).length };
  return shopify.isConfigured(cfg) && !shopifyPages ? { ...out, shopify_pages: 'access_denied' } : out;
}

/** إضافة رابط أو عدة روابط (سطر لكل رابط) — تُثبَّت مباشرة */
export function addPages(projectId, { urls, title, product_id, pinned = true }) {
  const base = storeBase(projectId);
  const list = (Array.isArray(urls) ? urls : String(urls || '').split(/[\n,]+/)).map((x) => String(x).trim()).filter(Boolean);
  if (!list.length) throw badRequest('url_required');
  const out = [];
  for (const raw of list.slice(0, 50)) {
    const withHost = /^https?:\/\//i.test(raw) ? raw : raw.startsWith('/') && base ? `${base}${raw}` : `https://${raw}`;
    const p = parse(withHost);
    if (!p || !/^https?:$/.test(p.u.protocol) || !p.u.hostname.includes('.')) throw badRequest('url_invalid', { url: raw });
    const url = canonical(p.u);
    const same = base && p.u.hostname === new URL(base).hostname;
    const kind = same && p.path.startsWith('/products/') ? 'product' : same && p.path.startsWith('/pages/') ? 'page' : 'url';
    const existing = db.prepare('SELECT id FROM store_pages WHERE project_id = ? AND url = ?').get(projectId, url);
    if (existing) {
      db.prepare('UPDATE store_pages SET pinned = ?, title = COALESCE(?, title), product_id = COALESCE(?, product_id) WHERE id = ?').run(pinned ? 1 : 0, title || null, product_id || null, existing.id);
      out.push(existing.id);
      continue;
    }
    const productId = product_id || (kind === 'product' ? db.prepare('SELECT id FROM products WHERE project_id = ? AND lower(handle) = lower(?)').get(projectId, p.path.slice('/products/'.length))?.id : null) || null;
    const info = db
      .prepare('INSERT INTO store_pages (project_id, kind, url, path, title, product_id, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, kind, url, p.path, title || `${p.path}${p.u.searchParams.get('view') ? ` · ${p.u.searchParams.get('view')}` : ''}`, productId, pinned ? 1 : 0);
    out.push(info.lastInsertRowid);
  }
  return out;
}

export function updatePage(id, b) {
  const cur = db.prepare('SELECT * FROM store_pages WHERE id = ?').get(id);
  if (!cur) throw notFound('page_not_found');
  const next = {
    pinned: b.pinned === undefined ? cur.pinned : b.pinned ? 1 : 0,
    title: b.title === undefined ? cur.title : v.str(b.title, { max: 200 }),
    note: b.note === undefined ? cur.note : v.str(b.note, { max: 2000 }),
    product_id: b.product_id === undefined ? cur.product_id : b.product_id ? v.int(b.product_id, { min: 1, name: 'product_id' }) : null,
  };
  db.prepare('UPDATE store_pages SET pinned = @pinned, title = @title, note = @note, product_id = @product_id WHERE id = @id').run({ ...next, id });
  return db.prepare('SELECT * FROM store_pages WHERE id = ?').get(id);
}

export function deletePage(id) {
  const cur = db.prepare('SELECT * FROM store_pages WHERE id = ?').get(id);
  if (!cur) throw notFound('page_not_found');
  // صفحات المتجر الموجودة تعود مع المزامنة: نزيل التثبيت فقط
  if (cur.synced_at && !cur.gone) throw badRequest('page_synced_unpin_instead');
  db.prepare('DELETE FROM store_pages WHERE id = ?').run(id);
  return cur;
}

/**
 * صحة النسب: من طلبيات آخر 14 يوماً، كم منها يحمل رابط الصفحة التي جاء منها الزبون؟
 * بدونه لا تُنسب الطلبيات للصفحات ولا لنسخ اختبار A/B (نموذج الطلب أو n8n لا يرسل landing_page/utm_content).
 */
export function attributionHealth(projectIds) {
  const since = dzDayStartIso(addDays(dzDay(), -13));
  const r = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(landing_url IS NOT NULL AND landing_url != ''), 0) AS with_page, COALESCE(SUM(utm_content IS NOT NULL AND utm_content != ''), 0) AS with_content
       FROM orders WHERE project_id IN (${inList(projectIds)}) AND created_at >= ? AND status NOT IN ('abandoned','fake')`,
    )
    .get(...projectIds, since);
  return { days: 14, orders: r.orders, with_page: r.with_page, with_content: r.with_content, ok: !r.orders || r.with_page / r.orders >= 0.5 };
}

/** القائمة مع الأداء: طلبيات آخر 30 يوماً دخلت من الصفحة (landing_url)، المسلّمة، والاختبارات التي تستعملها */
export function listPages(projectIds, { pinnedOnly = false } = {}) {
  const rows = db
    .prepare(
      `SELECT sp.*, p.title AS product_title FROM store_pages sp LEFT JOIN products p ON p.id = sp.product_id
       WHERE sp.project_id IN (${inList(projectIds)}) ${pinnedOnly ? 'AND sp.pinned = 1' : ''}
       ORDER BY sp.pinned DESC, CASE sp.kind WHEN 'product' THEN 0 WHEN 'url' THEN 1 ELSE 2 END, sp.title`,
    )
    .all(...projectIds);
  const since = dzDayStartIso(addDays(dzDay(), -29));
  const orders = db
    .prepare(`SELECT project_id, status, landing_url FROM orders WHERE project_id IN (${inList(projectIds)}) AND landing_url IS NOT NULL AND created_at >= ? AND status NOT IN ('abandoned','fake')`)
    .all(...projectIds, since);
  const byKey = new Map();
  const byPath = new Map();
  const add = (m, k, o) => {
    const e = m.get(k) || { orders: 0, delivered: 0, returned: 0 };
    e.orders++;
    if (o.status === 'delivered') e.delivered++;
    if (o.status === 'returned') e.returned++;
    m.set(k, e);
  };
  for (const o of orders) {
    const p = parse(o.landing_url);
    if (!p) continue;
    add(byKey, `${o.project_id}|${p.key}`, o);
    add(byPath, `${o.project_id}|${p.path.toLowerCase()}`, o);
  }
  const tests = db.prepare(`SELECT t.id, t.project_id, t.name, t.status, t.entry_path FROM split_tests t WHERE t.project_id IN (${inList(projectIds)}) AND t.status != 'ended'`).all(...projectIds);
  const variants = db.prepare(`SELECT test_id, url FROM split_variants WHERE test_id IN (${inList(tests.map((t) => t.id))})`).all(...tests.map((t) => t.id));
  for (const r of rows) {
    const p = parse(r.url);
    const hasView = p.key.includes('?view=');
    const s = (hasView ? byKey.get(`${r.project_id}|${p.key}`) : byPath.get(`${r.project_id}|${p.path.toLowerCase()}`)) || { orders: 0, delivered: 0, returned: 0 };
    const closed = s.delivered + s.returned;
    Object.assign(r, { orders_30d: s.orders, delivered_30d: s.delivered, delivery_rate: closed ? round((100 * s.delivered) / closed) : null });
    r.tests = tests
      .filter((t) => t.project_id === r.project_id && ((t.entry_path && parse(t.entry_path)?.path.toLowerCase() === p.path.toLowerCase()) || variants.some((x) => x.test_id === t.id && parse(x.url)?.key === p.key)))
      .map((t) => ({ id: t.id, name: t.name, status: t.status }));
  }
  return rows;
}
