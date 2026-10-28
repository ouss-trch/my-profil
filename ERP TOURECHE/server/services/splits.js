import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import * as shopify from '../integrations/shopify.js';
import { HttpError, badRequest, dzDay, nowIso, round, slugify } from '../lib/util.js';
import { SHIPPED_EVER } from '../lib/statuses.js';
import { projectConfig } from '../lib/settings.js';
import { getProduct } from './products.js';
import { getProject } from './projects.js';
import { attributionHealth } from './pages.js';
import { BOT_UA, pageKey, trackingHealth, visitorsWhere } from './tracking.js';

/**
 * اختبار صفحات الهبوط A/B (مثل «تيسير»):
 * رابط واحد في الإعلان ‎/go/<slug>‎ → يوزّع كل زائر جديد على صفحة A أو B أو C حسب الوزن،
 * ويُبقي الزائر نفسه على الصفحة نفسها (كوكي)، ويضيف utm_content=<slug>-<label> لربط كل طلبية بالصفحة التي جلبتها.
 * الحكم على الصفحات بالطلبيات المؤكدة/المسلّمة لا بالنقرات فقط.
 * ملاحظة سياسة Meta: كل الصفحات يجب أن تعرض نفس المنتج والعرض — لا نُرسل زاحف Meta إلى صفحة مختلفة عن الزوار (لا cloaking).
 */
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
// شروط الحكم: 7 أيام (14 إن كان الهدف التسليم: الطرود تعود بعد أيام)، 30 طلبية لكل نسخة، 1000 زائر لكل نسخة إن كانوا يُعدّون، و95% احتمال
export const SPLIT_RULES = { days: 7, daysDelivered: 14, orders: 30, visitors: 1000 };
const BOT = BOT_UA;
const PASS_PARAMS = /^(utm_\w+|fbclid|gclid|ttclid|campaign_id|adset_id|ad_id|placement|site_source_name)$/i;

export const contentTag = (slug, label) => `${slug}-${label}`.toLowerCase();

function hydrate(t) {
  if (!t) return null;
  const variants = db.prepare('SELECT * FROM split_variants WHERE test_id = ? ORDER BY label').all(t.id);
  return { ...t, sticky: Boolean(t.sticky), variants: variants.map((v) => ({ ...v, active: Boolean(v.active), tag: contentTag(t.slug, v.label) })) };
}

export function listTests(projectIds) {
  return db
    .prepare(`SELECT t.*, p.title AS product_title FROM split_tests t LEFT JOIN products p ON p.id = t.product_id WHERE t.project_id IN (${projectIds.map(() => '?').join(',')}) ORDER BY (t.status = 'running') DESC, t.id DESC`)
    .all(...projectIds)
    .map((t) => ({ ...hydrate(t), summary: quickSummary(t.id) }));
}

export function getTest(id) {
  const t = hydrate(db.prepare('SELECT * FROM split_tests WHERE id = ?').get(id));
  if (!t) throw new HttpError(404, 'split_not_found');
  return t;
}

const validUrl = (u) => {
  try {
    const x = new URL(String(u));
    return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null;
  } catch {
    return null;
  }
};

function cleanVariants(list) {
  if (!Array.isArray(list) || list.length < 2) throw badRequest('split_needs_two_variants');
  if (list.length > LABELS.length) throw badRequest('split_too_many_variants');
  return list.map((v, i) => {
    const url = validUrl(v.url);
    if (!url) throw badRequest(`split_variant_url_invalid:${LABELS[i]}`);
    return { label: LABELS[i], name: String(v.name || '').slice(0, 80) || null, url, weight: Math.max(0, Math.min(100, Math.round(Number(v.weight ?? 1)))), active: v.active === false ? 0 : 1 };
  });
}

export function createTest(projectId, input) {
  const name = String(input.name || '').trim().slice(0, 120);
  if (!name) throw badRequest('name_required');
  if (input.product_id) getProduct(Number(input.product_id));
  const variants = cleanVariants(input.variants);
  if (!variants.some((v) => v.active && v.weight > 0)) throw badRequest('split_no_active_variant');
  let slug = slugify(input.slug || name, 40) || `t${Date.now().toString(36)}`;
  if (db.prepare('SELECT 1 FROM split_tests WHERE slug = ?').get(slug)) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  const id = db.transaction(() => {
    const mode = input.mode === 'redirect' ? 'redirect' : 'shopify';
    const info = db
      .prepare('INSERT INTO split_tests (project_id, product_id, name, slug, status, mode, entry_path, sticky, goal, fallback_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        projectId,
        input.product_id || null,
        name,
        slug,
        'draft',
        mode,
        mode === 'shopify' ? entryPath(input.entry_path, variants) : null,
        input.sticky === false ? 0 : 1,
        // صفحة الهبوط تُقاس بمعدل تحويلها (الطلبيات)؛ التأكيد والتسليم يأتيان بعد أيام ويتأثران بالاتصال والتوصيل
        ['orders', 'confirmed', 'delivered'].includes(input.goal) ? input.goal : 'orders',
        validUrl(input.fallback_url),
        input.notes || null,
      );
    const stmt = db.prepare('INSERT INTO split_variants (test_id, label, name, url, weight, active) VALUES (?, ?, ?, ?, ?, ?)');
    for (const v of variants) stmt.run(info.lastInsertRowid, v.label, v.name, v.url, v.weight, v.active);
    return info.lastInsertRowid;
  })();
  const t = getTest(id);
  if (t.mode === 'shopify') syncShopifyQuiet(projectId);
  return t;
}

/** مسار الدخول على المتجر (الرابط الذي يوضع في الإعلان) — افتراضياً مسار الصفحة A دون معاملات */
function entryPath(raw, variants) {
  const v = String(raw || '').trim();
  let p = v;
  if (/^https?:\/\//i.test(v)) p = new URL(v).pathname;
  if (!p) p = new URL(variants[0].url).pathname;
  if (!p.startsWith('/')) throw badRequest('split_entry_path_invalid');
  return p.replace(/\/+$/, '') || '/';
}

/** تعديل الأوزان/الروابط/الحالة. تغيير الروابط أثناء التشغيل مسموح، لكن الحروف (A/B/C) ثابتة حتى لا تختلط النتائج */
export function updateTest(id, input) {
  const t = getTest(id);
  // اختبار واحد جارٍ لكل صفحة دخول: اختباران على نفس الزوار لا يعطيان نتيجتين بل نتيجتين خاطئتين
  if (input.status === 'running' && t.status !== 'running' && t.mode === 'shopify') {
    const p = input.entry_path !== undefined ? entryPath(input.entry_path, t.variants) : t.entry_path;
    const busy = db.prepare("SELECT name FROM split_tests WHERE project_id = ? AND mode = 'shopify' AND status = 'running' AND entry_path = ? AND id != ?").get(t.project_id, p, id);
    if (busy) throw badRequest(`split_entry_busy:${busy.name}`);
  }
  db.transaction(() => {
    if (input.name !== undefined || input.goal !== undefined || input.sticky !== undefined || input.fallback_url !== undefined || input.notes !== undefined || input.product_id !== undefined)
      db.prepare('UPDATE split_tests SET name = ?, goal = ?, sticky = ?, fallback_url = ?, notes = ?, product_id = ? WHERE id = ?').run(
        input.name ? String(input.name).slice(0, 120) : t.name,
        ['orders', 'confirmed', 'delivered'].includes(input.goal) ? input.goal : t.goal,
        input.sticky === undefined ? (t.sticky ? 1 : 0) : input.sticky ? 1 : 0,
        input.fallback_url === undefined ? t.fallback_url : validUrl(input.fallback_url),
        input.notes === undefined ? t.notes : input.notes,
        input.product_id === undefined ? t.product_id : input.product_id || null,
        id,
      );
    if (Array.isArray(input.variants)) {
      const next = cleanVariants(input.variants);
      for (const v of next) {
        const cur = t.variants.find((x) => x.label === v.label);
        if (cur) db.prepare('UPDATE split_variants SET name = ?, url = ?, weight = ?, active = ? WHERE id = ?').run(v.name, v.url, v.weight, v.active, cur.id);
        else db.prepare('INSERT INTO split_variants (test_id, label, name, url, weight, active) VALUES (?, ?, ?, ?, ?, ?)').run(id, v.label, v.name, v.url, v.weight, v.active);
      }
      // النسخ المحذوفة تُعطَّل (لا تُحذف) للحفاظ على تاريخ النقرات
      for (const cur of t.variants) if (!next.some((v) => v.label === cur.label)) db.prepare('UPDATE split_variants SET active = 0 WHERE id = ?').run(cur.id);
    }
    if (input.status && input.status !== t.status) {
      if (!['draft', 'running', 'paused', 'ended'].includes(input.status)) throw badRequest('status_invalid');
      db.prepare('UPDATE split_tests SET status = ?, started_at = COALESCE(started_at, CASE WHEN ? = \'running\' THEN ? END), ended_at = CASE WHEN ? = \'ended\' THEN ? ELSE NULL END WHERE id = ?').run(
        input.status,
        input.status,
        nowIso(),
        input.status,
        nowIso(),
        id,
      );
    }
    if (input.winner_variant_id !== undefined) db.prepare('UPDATE split_tests SET winner_variant_id = ? WHERE id = ?').run(input.winner_variant_id || null, id);
    if (input.entry_path !== undefined && t.mode === 'shopify') db.prepare('UPDATE split_tests SET entry_path = ? WHERE id = ?').run(entryPath(input.entry_path, t.variants), id);
  })();
  const after = getTest(id);
  if (!after.variants.some((v) => v.active && v.weight > 0)) throw badRequest('split_no_active_variant');
  if (after.mode === 'shopify') syncShopifyQuiet(after.project_id);
  return after;
}

/** قالب الصفحة في رابط النسخة (‎?view=lp-…‎ لصفحات الهبوط)، بأحرف صغيرة */
const viewOf = (url) => {
  try {
    return (new URL(url, 'https://store.invalid').searchParams.get('view') || '').toLowerCase();
  } catch {
    return '';
  }
};

/**
 * صفحة حُذفت أو سُحبت من المتجر (صفحة هبوط ‎?view=…‎): تُعطَّل نسختها في الاختبارات غير المنتهية حتى لا يُرسل زوار الإعلان إلى صفحة غير موجودة؛
 * اختبار جارٍ بقيت له أقل من نسختين يتوقف مؤقتاً. يُرجع عدد الاختبارات المتأثرة وأسماء الموقوفة.
 */
export function detachPage(projectId, view) {
  const v = String(view || '').toLowerCase();
  const rows = db
    .prepare("SELECT sv.id, sv.test_id, sv.url FROM split_variants sv JOIN split_tests t ON t.id = sv.test_id WHERE t.project_id = ? AND t.status != 'ended' AND sv.active = 1")
    .all(projectId)
    .filter((x) => viewOf(x.url) === v);
  const touched = new Set(rows.map((x) => x.test_id));
  const paused = [];
  db.transaction(() => {
    for (const x of rows) db.prepare('UPDATE split_variants SET active = 0 WHERE id = ?').run(x.id);
    for (const id of touched) {
      const t = db.prepare('SELECT name, status FROM split_tests WHERE id = ?').get(id);
      const live = db.prepare('SELECT COUNT(*) AS n FROM split_variants WHERE test_id = ? AND active = 1 AND weight > 0').get(id).n;
      if (t.status === 'running' && live < 2) {
        db.prepare("UPDATE split_tests SET status = 'paused' WHERE id = ?").run(id);
        paused.push(t.name);
      }
    }
  })();
  if (touched.size) syncShopifyQuiet(projectId);
  return { tests: touched.size, paused };
}

export function deleteTest(id) {
  const t = getTest(id);
  db.prepare('DELETE FROM split_tests WHERE id = ?').run(id);
  if (t.mode === 'shopify') syncShopifyQuiet(t.project_id);
}

// ——— التوجيه العام ‎/go/:slug‎ ———
export function pickVariant(test, stickyLabel) {
  const live = test.variants.filter((v) => v.active && v.weight > 0);
  if (!live.length) return null;
  if (test.sticky && stickyLabel) {
    const same = live.find((v) => v.label === stickyLabel);
    if (same) return same;
  }
  const total = live.reduce((s, v) => s + v.weight, 0);
  let r = crypto.randomInt(0, total);
  for (const v of live) {
    if (r < v.weight) return v;
    r -= v.weight;
  }
  return live[live.length - 1];
}

export function targetUrl(test, variant, query = {}) {
  const url = new URL(variant.url);
  for (const [k, val] of Object.entries(query)) if (PASS_PARAMS.test(k) && typeof val === 'string' && !url.searchParams.has(k)) url.searchParams.set(k, val.slice(0, 300));
  // utm_content الإعلان يبقى كما هو (اسم الإعلان)؛ النسخة تُعرف من erp_v في رابط الصفحة
  if (!url.searchParams.has('utm_content')) url.searchParams.set('utm_content', contentTag(test.slug, variant.label));
  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', query.fbclid ? 'meta' : 'split');
  url.searchParams.set('erp_v', `${test.slug}.${variant.label}`);
  return url.toString();
}

/** يُرجع رابط التحويل ومعلومات الكوكي. الحالات غير «running» تُحوَّل للرابط الاحتياطي أو للنسخة A دون تسجيل */
export function route(slug, { cookies = {}, query = {}, userAgent = '' }) {
  const row = db.prepare('SELECT * FROM split_tests WHERE slug = ?').get(String(slug).toLowerCase());
  if (!row) return null;
  const test = hydrate(row);
  const cookieName = `erp_sv_${test.id}`;
  const visitorCookie = 'erp_vid';
  const visitor = /^[a-f0-9]{16}$/.test(cookies[visitorCookie] || '') ? cookies[visitorCookie] : crypto.randomBytes(8).toString('hex');
  if (test.status !== 'running') {
    const winner = test.variants.find((v) => v.id === test.winner_variant_id);
    const fallback = winner || test.variants.find((v) => v.active) || test.variants[0];
    return { location: test.status === 'ended' && test.fallback_url ? test.fallback_url : targetUrl(test, fallback, query), cookies: [] };
  }
  const variant = pickVariant(test, cookies[cookieName]);
  if (!variant) return { location: test.fallback_url || test.variants[0].url, cookies: [] };
  const isBot = BOT.test(userAgent || '') || !userAgent;
  const first = cookies[cookieName] !== variant.label;
  db.prepare('INSERT INTO split_clicks (test_id, variant_id, visitor, first_visit, is_bot, from_ad, utm_campaign, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    test.id,
    variant.id,
    visitor,
    first ? 1 : 0,
    isBot ? 1 : 0,
    query.fbclid || /^(fb|ig|meta|facebook|instagram)/i.test(String(query.utm_source || '')) ? 1 : 0,
    typeof query.utm_campaign === 'string' ? query.utm_campaign.slice(0, 120) : null,
    nowIso(),
  );
  return {
    location: targetUrl(test, variant, query),
    cookies: isBot
      ? []
      : [
          { name: cookieName, value: variant.label, maxAge: 30 * 86400 },
          { name: visitorCookie, value: visitor, maxAge: 365 * 86400 },
        ],
  };
}

// ——— النتائج والإحصاء ———
/**
 * طلبيات النسخة: الطلبية تُنسب من رابط الصفحة التي أُرسل منها النموذج (erp_v فيه)، لا من utm_content:
 * نموذج الطلب يحفظ آخر UTM في المتصفح، فمن مرّ بالنسخة C ثم طلب من صفحة الهدية كان يُحسب للنسخة C.
 * utm_content احتياط فقط لطلبية بلا رابط صفحة (وضع التحويل القديم أو طلبية يدوية).
 */
function variantOrders(test, variant) {
  const tag = contentTag(test.slug, variant.label);
  const marker = `erp_v=${test.slug}.${variant.label}`.toLowerCase();
  return db
    .prepare(
      `SELECT status, total, cogs, created_at FROM orders WHERE project_id = ? AND status NOT IN ('abandoned','fake') AND created_at >= ?
       AND (LOWER(landing_url) LIKE ? OR ((landing_url IS NULL OR landing_url = '') AND LOWER(utm_content) = ?))`,
    )
    .all(test.project_id, test.started_at || test.created_at, `%${marker}%`, tag);
}

/**
 * الصفحة كلها (كل زوارها وطلبياتها منذ بداية الاختبار)، ومنها ما جاء خارج رابط الاختبار (رابطها المباشر، المتجر، إعلانات أخرى).
 * المباشر لا يدخل الحكم لأن الزائر لم يُوزَّع عشوائياً، لكنه تحويل الصفحة الحقيقي.
 */
function pageStats(test, variant) {
  const key = pageKey(variant.url);
  if (!key) return null;
  const since = test.started_at || test.created_at;
  const sinceDay = dzDay(since);
  const all = visitorsWhere(test.project_id, { page: key, sinceDay });
  const direct = visitorsWhere(test.project_id, { page: key, sinceDay, direct: true });
  const rows = db
    .prepare("SELECT landing_url FROM orders WHERE project_id = ? AND status NOT IN ('abandoned','fake') AND created_at >= ? AND landing_url IS NOT NULL AND landing_url != ''")
    .all(test.project_id, since)
    .filter((o) => pageKey(o.landing_url) === key);
  const allOrders = rows.length;
  const directOrders = rows.filter((o) => !/[?&]erp_v=/i.test(o.landing_url)).length;
  const conv = (o, v) => (v ? round((100 * o) / v, 2) : null);
  return {
    all: { visitors: all.visitors, orders: allOrders, form: all.form, conversion: conv(allOrders, all.visitors) },
    direct: { visitors: direct.visitors, orders: directOrders, conversion: conv(directOrders, direct.visitors) },
  };
}

/** عيّنة من توزيع Beta (Marsaglia–Tsang عبر Gamma) لحساب احتمال أن تكون كل نسخة هي الأفضل */
function gamma(k) {
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (a, b) => {
  const x = gamma(a);
  return x / (x + gamma(b));
};

export function probabilityBest(arms, draws = 20000) {
  const wins = arms.map(() => 0);
  for (let i = 0; i < draws; i++) {
    let best = -1;
    let bestIdx = 0;
    arms.forEach((a, j) => {
      const s = beta(1 + a.successes, 1 + Math.max(0, a.trials - a.successes));
      if (s > best) {
        best = s;
        bestIdx = j;
      }
    });
    wins[bestIdx]++;
  }
  return wins.map((w) => w / draws);
}

function quickSummary(testId) {
  const t = db.prepare('SELECT project_id, slug, mode, started_at, created_at FROM split_tests WHERE id = ?').get(testId);
  // وضع Shopify: زوار رابط الاختبار من عدّاد المتجر (كل صفحة تحمل erp_v=<slug>.<حرف>)
  if (t?.mode === 'shopify') {
    const r = db
      .prepare('SELECT COUNT(DISTINCT visitor) AS visitors, COALESCE(SUM(views), 0) AS clicks FROM page_visits WHERE project_id = ? AND ab LIKE ? AND day >= ?')
      .get(t.project_id, `${t.slug.toLowerCase()}.%`, dzDay(t.started_at || t.created_at));
    return { visitors: r.visitors, clicks: r.clicks };
  }
  const r = db
    .prepare('SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS clicks FROM split_clicks WHERE test_id = ? AND is_bot = 0 AND direct = 0')
    .get(testId);
  return { visitors: r.visitors, clicks: r.clicks };
}

export function results(id) {
  const test = getTest(id);
  const cfg = projectConfig(test.project_id);
  const goal = test.goal;
  const sinceDay = dzDay(test.started_at || test.created_at);
  const variants = test.variants.map((v) => {
    // وضع Shopify: عدّاد المتجر (الروبوتات لا تُسجَّل أصلاً)؛ وضع التحويل ‎/go/‎: نقرات الرابط
    const human =
      test.mode === 'shopify'
        ? (({ visitors, from_ad }) => ({ visitors, clicks: visitors, from_ad, bots: 0 }))(visitorsWhere(test.project_id, { ab: `${test.slug}.${v.label}`, sinceDay }))
        : db
            .prepare(
              `SELECT COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor END) AS visitors, COALESCE(SUM(is_bot = 0), 0) AS clicks,
                 COALESCE(SUM(is_bot = 0 AND from_ad = 1), 0) AS from_ad, COALESCE(SUM(is_bot), 0) AS bots FROM split_clicks WHERE variant_id = ? AND direct = 0`,
            )
            .get(v.id);
    const orders = variantOrders(test, v);
    const page = test.mode === 'shopify' ? pageStats(test, v) : null;
    const confirmed = orders.filter((o) => ['confirmed', ...SHIPPED_EVER].includes(o.status)).length;
    const delivered = orders.filter((o) => o.status === 'delivered');
    const returned = orders.filter((o) => o.status === 'returned').length;
    const successes = goal === 'orders' ? orders.length : goal === 'confirmed' ? confirmed : delivered.length;
    return {
      ...v,
      visitors: human.visitors || 0,
      clicks: human.clicks || 0,
      from_ad: human.from_ad || 0,
      bots: human.bots || 0,
      orders: orders.length,
      confirmed,
      delivered: delivered.length,
      returned,
      in_flight: confirmed - delivered.length - returned,
      revenue: round(delivered.reduce((s, o) => s + o.total, 0)),
      profit_before_ads: round(delivered.reduce((s, o) => s + o.total - (o.cogs || 0), 0)),
      conversion: human.visitors ? round((100 * orders.length) / human.visitors, 2) : null,
      confirm_rate: orders.length ? round((100 * confirmed) / orders.length) : null,
      delivery_rate: delivered.length + returned ? round((100 * delivered.length) / (delivered.length + returned)) : null,
      goal_rate: human.visitors ? round((100 * successes) / human.visitors, 2) : null,
      successes,
      page,
      direct: page?.direct || null,
    };
  });
  const arms = variants.filter((v) => v.active || v.visitors || v.successes);
  const tracked = arms.reduce((s, v) => s + v.visitors, 0) >= 50;
  const probs =
    arms.length < 2
      ? arms.map(() => null)
      : tracked
        ? probabilityBest(arms.map((v) => ({ successes: v.successes, trials: Math.max(v.visitors, v.successes) })))
        : probabilityBestByWeights(arms.map((v) => ({ successes: v.successes, weight: Math.max(1, v.weight) })));
  arms.forEach((v, i) => (v.p_best = probs[i] === null ? null : round(probs[i] * 100, 1)));
  const minVisitors = Math.min(...arms.map((v) => v.visitors));
  const leader = [...arms].sort((a, b) => (b.p_best ?? 0) - (a.p_best ?? 0))[0];
  // ما ينتظره الحكم (قواعد مثل «تسيير»): مدة دنيا، طلبيات لكل نسخة، وزوار لكل نسخة إن كانوا يُعدّون
  const rules = { days: goal === 'delivered' ? SPLIT_RULES.daysDelivered : SPLIT_RULES.days, orders: SPLIT_RULES.orders, visitors: tracked ? SPLIT_RULES.visitors : null };
  const days = Math.floor((Date.now() - Date.parse(test.started_at || test.created_at)) / 86400e3);
  const minOrders = arms.length ? Math.min(...arms.map((v) => v.orders)) : 0;
  const waiting = [];
  if (days < rules.days) waiting.push({ key: 'days', have: days, need: rules.days });
  if (minOrders < rules.orders) waiting.push({ key: 'orders', have: minOrders, need: rules.orders });
  if (tracked && minVisitors < rules.visitors) waiting.push({ key: 'visitors', have: minVisitors, need: rules.visitors });
  // توزيع مكسور: الزوار لا يتبعون الأوزان أكثر مما تفسّره الصدفة ← لا حكم (أشيع سبب لنتيجة واثقة وخاطئة)
  const live = arms.filter((v) => v.active && v.weight > 0);
  const srm = tracked && live.length >= 2 && splitIsBroken(live);
  let verdict = 'collecting';
  if (arms.length < 2) verdict = 'collecting';
  else if (srm) verdict = 'split_broken';
  else if (!waiting.length) verdict = leader?.p_best >= 95 ? 'winner' : leader?.p_best >= 70 ? 'trending' : 'no_difference';
  else if (leader?.p_best >= 70) verdict = 'trending';
  return {
    test: {
      ...test,
      public_url: test.mode === 'shopify' ? storeUrl(cfg.store_domain || getProject(test.project_id)?.domain, test.entry_path && `${test.entry_path}?erp_t=${test.slug}`) : publicBase(cfg) ? `${publicBase(cfg)}/go/${test.slug}` : null,
    },
    estimation: tracked ? 'visitors' : 'weights',
    goal,
    variants,
    verdict,
    rules,
    days,
    waiting,
    leader: leader ? { id: leader.id, label: leader.label, p_best: leader.p_best } : null,
    visitors_needed_per_variant: tracked ? Math.max(0, rules.visitors - minVisitors) : 0,
  };
}

/** فحص Chi² لتوزيع الزوار مقابل الأوزان (p < 0.001) */
const CHI2_P001 = [10.83, 13.82, 16.27, 18.47, 20.52];
export function splitIsBroken(arms) {
  const total = arms.reduce((s, v) => s + v.visitors, 0);
  const weights = arms.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total < 100 || !weights) return false;
  const chi2 = arms.reduce((s, v) => {
    const expected = (total * Math.max(0, v.weight)) / weights;
    return expected > 0 ? s + (v.visitors - expected) ** 2 / expected : s;
  }, 0);
  return chi2 > CHI2_P001[Math.min(arms.length - 2, CHI2_P001.length - 1)];
}

/** للمستشار: الاختبارات الجارية التي ظهر فيها فائز أو التي لا يصلها أي زائر */
export function splitInsights(projectIds) {
  const out = [];
  for (const t of db.prepare(`SELECT id FROM split_tests WHERE status = 'running' AND project_id IN (${projectIds.map(() => '?').join(',')})`).all(...projectIds)) {
    const r = results(t.id);
    const age = (Date.now() - Date.parse(r.test.started_at || r.test.created_at)) / 3600e3;
    // الزوار لا يُعدّون في وضع Shopify دون رابط عام: الإشارة عندها هي غياب الطلبيات المنسوبة، لا غياب الزوار
    const counted = r.estimation === 'visitors' || r.test.mode === 'redirect' || Boolean(publicBase(projectConfig(r.test.project_id)));
    out.push({
      ...r,
      age_hours: age,
      no_traffic: counted && age > 24 && r.variants.every((v) => !v.visitors),
      no_attribution: !counted && age > 48 && r.variants.every((v) => !v.orders),
    });
  }
  return out;
}

// ————————————————————————————————————————————————
// وضع Shopify: الدوران داخل المتجر نفسه (نفس الدومين، يعمل 24/7 دون جهازك)
// ————————————————————————————————————————————————
const SNIPPET_FILE = 'snippets/erp-split.liquid';
export const RENDER_LINE = "{% render 'erp-split' %}";
// لصق يدوي ترك «%}» زائدة بعد السطر: تظهر نصاً في أعلى كل صفحة من المتجر
const STRAY_AFTER_RENDER = /\{%-?\s*render\s+'erp-split'\s*-?%\}(?:[ \t]*%\})+/;

/**
 * السنيبت (v3) في رأس كل صفحات المتجر — يقرأ الإعدادات من metafield المتجر:
 *  1) عدّاد زوار مخفي: زيارة واحدة لكل صفحة تُرسل إلى الـ ERP (sendBeacon، لا يؤخر الصفحة)، و«بدأ النموذج» عند أول لمسة له؛
 *     لا يُعدّ: محرر القالب، المعاينة، الصفحات المحمّلة مسبقاً قبل فتحها، ومن فتح المتجر مرة بـ ‎?erp_me=1‎ (جهاز التاجر)؛
 *  2) اختبار A/B: رابط الإعلان وحده (‎?erp_t=<slug>‎) يُوزَّع على النسخ؛ صفحة المنتج العادية لا تتغيّر لأحد،
 *     ورابط صفحة هبوط بعينها (‎?view=lp-…‎) يبقى عليها. النسخة تُعرف من ‎erp_v‎ في رابط الصفحة (العدّاد والطلبية معاً).
 */
export function snippetLiquid() {
  return `{%- comment -%} ERP TOURECHE · عدّاد الزوار + اختبار صفحات الهبوط A/B — يُحدَّث تلقائياً من الـ ERP، لا تعدّله يدوياً {%- endcomment -%}
{%- assign erp_ab = shop.metafields.${shopify.SPLIT_NAMESPACE}.${shopify.SPLIT_KEY}.value -%}
{%- if erp_ab.b or erp_ab.tests.size > 0 -%}
<script>
(function(){var D=document,H=D.documentElement;try{
var C={{ erp_ab | json }};if(!C||C.v!==3)return;
var L=location,q=new URLSearchParams(L.search),key=q.get('erp_t'),i,j,t;
if(q.has('preview_theme_id')||q.has('oseid')||(window.Shopify&&Shopify.designMode))return;
var st=function(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}};
if(q.get('erp_me')==='1')st('erp_me','1');if(q.get('erp_me')==='0')st('erp_me','');
if(key&&!q.has('erp_v')&&C.tests)for(i=0;i<C.tests.length;i++){t=C.tests[i];if(key!==t.s)continue;
var pick=null,ck='erp_sv_'+t.s;
if(t.st){var m=D.cookie.match(new RegExp('(?:^|; )'+ck+'=([A-F])'));if(m)for(j=0;j<t.v.length;j++)if(t.v[j].l===m[1])pick=t.v[j];}
if(!pick){var tot=0;for(j=0;j<t.v.length;j++)tot+=t.v[j].w;var r=Math.random()*tot;for(j=0;j<t.v.length;j++){r-=t.v[j].w;if(r<0){pick=t.v[j];break;}}if(!pick)pick=t.v[t.v.length-1];}
if(t.st)D.cookie=ck+'='+pick.l+'; path=/; max-age=2592000; SameSite=Lax';
var u=new URL(pick.u,L.origin),pre=(L.pathname.match(/^\\/[a-z]{2}(-[a-z]{2})?(?=\\/)/i)||[''])[0];
if(pre&&u.pathname.indexOf(pre+'/')!==0)u.pathname=pre+u.pathname;
q.forEach(function(v,k){if(k!=='erp_t'&&k!=='view'&&!u.searchParams.has(k))u.searchParams.set(k,v);});
u.searchParams.set('erp_v',t.s+'.'+pick.l);
H.style.opacity='0';setTimeout(function(){H.style.opacity='';},2500);
L.replace(u.toString());return;}
if(!C.b||!C.k||st('erp_me')==='1'||navigator.webdriver)return;
var vid=st('erp_vid');if(!/^[a-f0-9]{16}$/.test(vid||'')){vid=(Math.random().toString(16).slice(2)+Math.random().toString(16).slice(2)+'0000000000000000').slice(0,16);st('erp_vid',vid);}
var send=function(e){try{navigator.sendBeacon(C.b+'/sp/'+C.k,JSON.stringify({e:e,u:(L.pathname+L.search).slice(0,1400),r:e==='v'?D.referrer:'',vid:vid,t:{{ request.page_type | json }}}));}catch(x){}};
var go=function(){send('v');};if(D.prerendering)D.addEventListener('prerenderingchange',go,{once:true});else go();
var f=0;D.addEventListener('focusin',function(ev){var x=ev.target;if(f||!x||!x.closest||!x.closest('[data-lead-form]'))return;f=1;send('f');},true);
}catch(e){H.style.opacity='';}})();
</script>
{%- endif -%}
`;
}

/** عنوان الـ ERP العام لعدّ الزوار: إعداد المشروع، وإلا عنوان الـ VPS نفسه (ERP_PUBLIC_URL أو أول ERP_ALLOWED_ORIGINS) */
export const publicBase = (cfg) => String(cfg.split_base_url || config.publicUrl || '').replace(/\/$/, '');

const storeUrl = (domain, p) => (domain && p ? `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/$/, '')}${p}` : null);

const relTarget = (url, storeDomain) => {
  const u = new URL(url, `https://${storeDomain || 'store.invalid'}`);
  return `${u.pathname}${u.search}`;
};

/**
 * الإعدادات التي تُكتب في metafield: الاختبارات الجارية + الاختبارات المنتهية بفائز (توجيه دائم إليه).
 * لا يُوجَّه أي زائر إلى نسخة صفحتها غير موجودة: صفحة هبوط غير منشورة في الـ ERP (سُحبت)، أو قالبها ‎product.lp-…‎ غائب
 * عن القالب المنشور (views: قوالب ‎lp-…‎ الموجودة فعلاً، إن عُرفت؛ تغيّر القالب مثلاً). وإلا رأى زوارها صفحة المنتج العادية
 * والاختبار يقارن الصفحة بنفسها. skipped: النسخ المستبعدة، تُعرض للتاجر.
 */
function buildShopifyConfig(projectId, views = null) {
  const cfg = projectConfig(projectId);
  const withdrawn = new Set(
    db
      .prepare("SELECT LOWER(COALESCE(NULLIF(template_suffix, ''), 'lp-' || slug)) AS v FROM landing_pages WHERE project_id = ? AND status != 'published'")
      .all(projectId)
      .map((r) => r.v),
  );
  const gone = (url) => {
    const v = viewOf(url);
    return Boolean(v) && (withdrawn.has(v) || (Boolean(views) && v.startsWith('lp-') && !views.has(v)));
  };
  const rows = db.prepare("SELECT * FROM split_tests WHERE project_id = ? AND mode = 'shopify' AND status IN ('running','ended')").all(projectId).map(hydrate);
  const tests = [];
  const skipped = [];
  for (const t of rows) {
    if (!t.entry_path) continue;
    if (t.status === 'running') {
      const live = t.variants.filter((x) => x.active && x.weight > 0);
      for (const x of live.filter((y) => gone(y.url))) skipped.push({ test: t.name, label: x.label, url: x.url });
      const v = live.filter((x) => !gone(x.url)).map((x) => ({ l: x.label, u: relTarget(x.url, cfg.store_domain), w: x.weight }));
      if (v.length) tests.push({ s: t.slug, st: t.sticky ? 1 : 0, c: 1, v });
    } else if (t.winner_variant_id) {
      const w = t.variants.find((x) => x.id === t.winner_variant_id);
      const target = w && !gone(w.url) && relTarget(w.url, cfg.store_domain);
      // الفائز المعتمد: رابط الإعلان يبقى يوجّه إليه (صفحة المنتج العادية لا تتغيّر)
      if (target) tests.push({ s: t.slug, st: 0, c: 0, v: [{ l: w.label, u: target, w: 1 }] });
      else if (w) skipped.push({ test: t.name, label: w.label, url: w.url });
    }
  }
  const base = publicBase(cfg);
  // v3: عدّاد الزوار على كل الصفحات (k = المشروع) + التوزيع بمفتاح رابط الإعلان (erp_t). السنيبتات القديمة (v1/v2) لا تعمل بهذه الإعدادات
  return { conf: { v: 3, b: base ? `${base}/api/hooks` : null, k: getProject(projectId)?.slug || null, tests }, skipped };
}
export const shopifyConfig = (projectId, views = null) => buildShopifyConfig(projectId, views).conf;

/** قوالب صفحات الهبوط الموجودة في القالب المنشور (‎product.lp-x‎ ← ‎lp-x‎)؛ null إن تعذّرت القراءة: لا تُستبعد نسخة دون يقين */
async function liveViews(cfg) {
  try {
    const theme = await shopify.mainTheme(cfg);
    if (!theme) return null;
    const names = await shopify.themeFileNames(cfg, theme.id, 'templates/product.lp-*');
    return new Set(names.map((f) => f.replace(/^templates\/product\./, '').replace(/\.(json|liquid)$/, '').toLowerCase()));
  } catch {
    return null;
  }
}

const syncState = new Map();
export async function syncShopify(projectId) {
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg)) throw new HttpError(400, 'shopify_not_configured');
  const { conf, skipped } = buildShopifyConfig(projectId, await liveViews(cfg));
  await shopify.setShopJsonMetafield(cfg, shopify.SPLIT_NAMESPACE, shopify.SPLIT_KEY, conf);
  syncState.set(projectId, { at: nowIso(), tests: conf.tests.length, skipped, error: null });
  return { tests: conf.tests.length, skipped };
}
function syncShopifyQuiet(projectId) {
  if (!shopify.isConfigured(projectConfig(projectId))) return;
  syncShopify(projectId).catch((e) => syncState.set(projectId, { at: nowIso(), error: e.message }));
}

export async function shopifyStatus(projectId) {
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg)) return { configured: false };
  const out = { configured: true, sync: syncState.get(projectId) || null, render_line: RENDER_LINE, snippet: snippetLiquid(), beacon: shopifyConfig(projectId).b, attribution: attributionHealth([projectId]), tracking: trackingHealth([projectId]) };
  try {
    const theme = await shopify.mainTheme(cfg);
    out.theme = theme;
    if (theme) {
      const files = await shopify.themeFiles(cfg, theme.id, ['layout/theme.liquid', SNIPPET_FILE]);
      const layout = files.find((f) => f.filename === 'layout/theme.liquid')?.content || '';
      const snippet = files.find((f) => f.filename === SNIPPET_FILE);
      out.snippet_present = Boolean(snippet);
      // لصق يدوي فيه زيادة: «تثبيت على القالب» يصلحه
      out.paste_broken = STRAY_AFTER_RENDER.test(layout) || /endif\s*-?%\}\s*(?:%\}\s*)+$/.test(snippet?.content || '');
      out.installed = out.snippet_present && layout.includes("render 'erp-split'") && !out.paste_broken;
      out.snippet_outdated = Boolean(snippet && snippet.content !== null && snippet.content.trim() !== snippetLiquid().trim());
      // سنيبت قديم في قالب مثبّت أصلاً: يُحدَّث هنا مباشرة (كان يبقى قديماً حتى يضغط التاجر «تثبيت» فلا يُعدّ أي زائر)
      if (out.installed && out.snippet_outdated) {
        await refreshSnippet(cfg, theme.id, projectId);
        out.snippet_outdated = false;
        out.auto_updated = true;
      }
    }
  } catch (e) {
    out.theme_error = e.message;
    if (/access_denied/.test(e.message)) out.missing_scopes = await missingScopes(cfg, ['read_themes', 'write_themes']);
  }
  return out;
}

async function refreshSnippet(cfg, themeId, projectId) {
  await shopify.upsertThemeFiles(cfg, themeId, [{ filename: SNIPPET_FILE, content: snippetLiquid() }]);
  await syncShopify(projectId);
}

/**
 * عند تشغيل الـ ERP (بعد كل تحديث) وكل ساعة: إن كان السنيبت مثبتاً في القالب المنشور وتغيّر في هذه النسخة، يُحدَّث وحده،
 * وتُكتب الإعدادات (رابط العدّ، الاختبارات). تثبيت أول مرة أو قالب جديد بلا سطر التثبيت: يبقى قراراً للتاجر (كلمة المرور الحساسة).
 */
export async function ensureTracking(projectId) {
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg)) return { state: 'no_shopify' };
  const theme = await shopify.mainTheme(cfg);
  if (!theme) return { state: 'no_theme' };
  const files = await shopify.themeFiles(cfg, theme.id, ['layout/theme.liquid', SNIPPET_FILE]);
  const layout = files.find((f) => f.filename === 'layout/theme.liquid')?.content || '';
  const snippet = files.find((f) => f.filename === SNIPPET_FILE);
  if (!layout.includes("render 'erp-split'") || !snippet) return { state: 'not_installed' };
  const outdated = snippet.content !== null && snippet.content.trim() !== snippetLiquid().trim();
  if (outdated) await refreshSnippet(cfg, theme.id, projectId);
  else await syncShopify(projectId);
  return { state: 'ok', updated: outdated };
}

/** بعد رفض Shopify (access_denied): أي الصلاحيات ينقص الرمز فعلاً؟ null إن تعذّر السؤال */
async function missingScopes(cfg, needed) {
  const granted = await shopify.grantedScopes(cfg).catch(() => null);
  return granted ? needed.filter((s) => !shopify.hasScope(granted, s)) : null;
}

/** تثبيت تلقائي على القالب المنشور (مع نسخة احتياطية لـ theme.liquid). إن رفضت Shopify: التثبيت يدوي */
export async function installShopify(projectId) {
  const cfg = projectConfig(projectId);
  let theme;
  try {
    theme = await shopify.mainTheme(cfg);
    if (!theme) throw new HttpError(404, 'theme_not_found');
    const [layoutFile] = await shopify.themeFiles(cfg, theme.id, ['layout/theme.liquid']);
    const layout = layoutFile?.content;
    if (!layout) throw new HttpError(409, 'theme_layout_unreadable');
    const files = [{ filename: SNIPPET_FILE, content: snippetLiquid() }];
    let next = layout;
    if (!layout.includes("render 'erp-split'")) {
      const m = /<head[^>]*>/i.exec(layout);
      if (!m) throw new HttpError(409, 'theme_head_not_found');
      next = `${layout.slice(0, m.index + m[0].length)}\n    ${RENDER_LINE}${layout.slice(m.index + m[0].length)}`;
    } else next = layout.replace(STRAY_AFTER_RENDER, RENDER_LINE); // إصلاح لصق يدوي خاطئ
    if (next !== layout) {
      fs.mkdirSync(config.backupsDir, { recursive: true });
      fs.writeFileSync(path.join(config.backupsDir, `theme-${projectId}-${Date.now()}.liquid`), layout);
      files.push({ filename: 'layout/theme.liquid', content: next });
    }
    await shopify.upsertThemeFiles(cfg, theme.id, files);
  } catch (e) {
    if (!/access_denied/.test(e.message)) throw e;
    // صلاحية ناقصة (أو أُضيفت في Dev Dashboard ولم يُوافَق عليها في المتجر)، أم رفض من Shopify نفسها رغم وجودها
    const missing = await missingScopes(cfg, ['read_themes', 'write_themes']);
    throw new HttpError(403, missing?.length ? 'theme_scopes_missing' : 'theme_write_refused', null, { missing_scopes: missing });
  }
  await syncShopify(projectId);
  return { installed: true, theme: theme.name };
}

export async function uninstallShopify(projectId) {
  const cfg = projectConfig(projectId);
  await shopify.setShopJsonMetafield(cfg, shopify.SPLIT_NAMESPACE, shopify.SPLIT_KEY, { v: 3, b: null, k: null, tests: [] });
  const theme = await shopify.mainTheme(cfg);
  const [layoutFile] = theme ? await shopify.themeFiles(cfg, theme.id, ['layout/theme.liquid']) : [];
  if (layoutFile?.content?.includes(RENDER_LINE)) await shopify.upsertThemeFiles(cfg, theme.id, [{ filename: 'layout/theme.liquid', content: layoutFile.content.replace(`\n    ${RENDER_LINE}`, '').replace(RENDER_LINE, '') }]);
  return { uninstalled: true };
}

/** نقرة مُرسلة من السنيبت (navigator.sendBeacon) — تُحتسب فقط إن كان الـ ERP متاحاً من الإنترنت */
export function recordHit(slug, { v, vid, ad, c, d }, userAgent) {
  const t = db.prepare("SELECT * FROM split_tests WHERE slug = ? AND status = 'running'").get(String(slug).toLowerCase());
  if (!t) return false;
  const variant = db.prepare('SELECT id FROM split_variants WHERE test_id = ? AND label = ?').get(t.id, String(v || '').toUpperCase());
  if (!variant) return false;
  const visitor = /^[a-f0-9]{16}$/.test(String(vid || '')) ? vid : crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO split_clicks (test_id, variant_id, visitor, first_visit, is_bot, from_ad, utm_campaign, direct, at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)').run(
    t.id,
    variant.id,
    visitor,
    BOT.test(userAgent || '') || !userAgent ? 1 : 0,
    ad ? 1 : 0,
    c ? String(c).slice(0, 120) : null,
    d ? 1 : 0,
    nowIso(),
  );
  return true;
}

/**
 * دون عدّ الزوار (الـ ERP غير متاح من الإنترنت): التوزيع عشوائي بأوزان معروفة، فعدد زوار كل نسخة ≈ نسبة وزنها.
 * نقارن «النجاحات لكل وحدة وزن» بنموذج Poisson-Gamma: λ_i ~ Gamma(1 + s_i, w_i).
 */
export function probabilityBestByWeights(arms, draws = 20000) {
  const total = arms.reduce((s, a) => s + a.weight, 0) || 1;
  const wins = arms.map(() => 0);
  for (let i = 0; i < draws; i++) {
    let best = -1;
    let idx = 0;
    arms.forEach((a, j) => {
      const x = gamma(1 + a.successes) / (a.weight / total);
      if (x > best) {
        best = x;
        idx = j;
      }
    });
    wins[idx]++;
  }
  return wins.map((w) => w / draws);
}
