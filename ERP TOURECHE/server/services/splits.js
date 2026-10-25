import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { HttpError, badRequest, nowIso, round, slugify } from '../lib/util.js';
import { SHIPPED_EVER } from '../lib/statuses.js';
import { projectConfig } from '../lib/settings.js';
import { getProduct } from './products.js';

/**
 * اختبار صفحات الهبوط A/B (مثل «تيسير»):
 * رابط واحد في الإعلان ‎/go/<slug>‎ → يوزّع كل زائر جديد على صفحة A أو B أو C حسب الوزن،
 * ويُبقي الزائر نفسه على الصفحة نفسها (كوكي)، ويضيف utm_content=<slug>-<label> لربط كل طلبية بالصفحة التي جلبتها.
 * الحكم على الصفحات بالطلبيات المؤكدة/المسلّمة لا بالنقرات فقط.
 * ملاحظة سياسة Meta: كل الصفحات يجب أن تعرض نفس المنتج والعرض — لا نُرسل زاحف Meta إلى صفحة مختلفة عن الزوار (لا cloaking).
 */
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
const BOT = /bot|crawl|spider|facebookexternalhit|facebookcatalog|meta-externalagent|preview|slurp|bingpreview|whatsapp|telegrambot|headless|lighthouse|curl|wget|python|axios|node-fetch/i;
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
    const info = db
      .prepare('INSERT INTO split_tests (project_id, product_id, name, slug, status, sticky, goal, fallback_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, input.product_id || null, name, slug, 'draft', input.sticky === false ? 0 : 1, ['orders', 'confirmed', 'delivered'].includes(input.goal) ? input.goal : 'delivered', validUrl(input.fallback_url), input.notes || null);
    const stmt = db.prepare('INSERT INTO split_variants (test_id, label, name, url, weight, active) VALUES (?, ?, ?, ?, ?, ?)');
    for (const v of variants) stmt.run(info.lastInsertRowid, v.label, v.name, v.url, v.weight, v.active);
    return info.lastInsertRowid;
  })();
  return getTest(id);
}

/** تعديل الأوزان/الروابط/الحالة. تغيير الروابط أثناء التشغيل مسموح، لكن الحروف (A/B/C) ثابتة حتى لا تختلط النتائج */
export function updateTest(id, input) {
  const t = getTest(id);
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
  })();
  const after = getTest(id);
  if (!after.variants.some((v) => v.active && v.weight > 0)) throw badRequest('split_no_active_variant');
  return after;
}

export function deleteTest(id) {
  getTest(id);
  db.prepare('DELETE FROM split_tests WHERE id = ?').run(id);
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
  url.searchParams.set('utm_content', contentTag(test.slug, variant.label));
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
function variantOrders(test, variant) {
  const tag = contentTag(test.slug, variant.label);
  const marker = `erp_v=${test.slug}.${variant.label}`;
  return db
    .prepare(
      `SELECT status, total, cogs, created_at FROM orders WHERE project_id = ? AND status != 'abandoned' AND created_at >= ?
       AND (LOWER(utm_content) = ? OR landing_url LIKE ?)`,
    )
    .all(test.project_id, test.started_at || test.created_at, tag, `%${marker}%`);
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
  const r = db
    .prepare('SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS clicks FROM split_clicks WHERE test_id = ? AND is_bot = 0')
    .get(testId);
  return { visitors: r.visitors, clicks: r.clicks };
}

export function results(id) {
  const test = getTest(id);
  const cfg = projectConfig(test.project_id);
  const goal = test.goal;
  const variants = test.variants.map((v) => {
    const human = db
      .prepare(
        `SELECT COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor END) AS visitors, COALESCE(SUM(is_bot = 0), 0) AS clicks,
           COALESCE(SUM(is_bot = 0 AND from_ad = 1), 0) AS from_ad, COALESCE(SUM(is_bot), 0) AS bots FROM split_clicks WHERE variant_id = ?`,
      )
      .get(v.id);
    const orders = variantOrders(test, v);
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
    };
  });
  const arms = variants.filter((v) => v.active || v.visitors);
  const probs = arms.length >= 2 ? probabilityBest(arms.map((v) => ({ successes: v.successes, trials: Math.max(v.visitors, v.successes) }))) : arms.map(() => null);
  arms.forEach((v, i) => (v.p_best = probs[i] === null ? null : round(probs[i] * 100, 1)));
  const minVisitors = Math.min(...arms.map((v) => v.visitors));
  const minSuccesses = Math.min(...arms.map((v) => v.successes));
  const leader = [...arms].sort((a, b) => (b.p_best ?? 0) - (a.p_best ?? 0))[0];
  let verdict = 'collecting';
  if (arms.length >= 2 && leader?.p_best >= 95 && minVisitors >= 150 && leader.successes >= 10) verdict = 'winner';
  else if (arms.length >= 2 && minVisitors >= 1500 && minSuccesses >= 20 && leader?.p_best < 80) verdict = 'no_difference';
  // تقدير الزوار الإضافيين اللازمين (قاعدة تقريبية: 10 نجاحات على الأقل لكل نسخة + فارق واضح)
  const rate = arms.reduce((s, v) => s + v.successes, 0) / Math.max(1, arms.reduce((s, v) => s + v.visitors, 0));
  const needed = rate > 0 ? Math.max(0, Math.ceil(10 / rate) - minVisitors) : null;
  return {
    test: { ...test, public_url: cfg.split_base_url ? `${cfg.split_base_url.replace(/\/$/, '')}/go/${test.slug}` : null },
    goal,
    variants,
    verdict,
    leader: leader ? { id: leader.id, label: leader.label, p_best: leader.p_best } : null,
    visitors_needed_per_variant: verdict === 'collecting' ? needed : 0,
  };
}

/** للمستشار: الاختبارات الجارية التي ظهر فيها فائز أو التي لا يصلها أي زائر */
export function splitInsights(projectIds) {
  const out = [];
  for (const t of db.prepare(`SELECT id FROM split_tests WHERE status = 'running' AND project_id IN (${projectIds.map(() => '?').join(',')})`).all(...projectIds)) {
    const r = results(t.id);
    const age = (Date.now() - Date.parse(r.test.started_at || r.test.created_at)) / 3600e3;
    out.push({ ...r, age_hours: age, no_traffic: age > 24 && r.variants.every((v) => !v.visitors) });
  }
  return out;
}
