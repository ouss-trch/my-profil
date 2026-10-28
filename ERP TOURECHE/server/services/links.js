import { db } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { addDays, badRequest, dzDay } from '../lib/util.js';
import * as shopify from '../integrations/shopify.js';
import { pageKey } from './tracking.js';

/**
 * الروابط المكسورة: صفحات «غير موجودة» (404) زارها الناس فعلاً (من العدّاد المخفي)، وتحويلات Shopify تشير إلى منتج لم يعد موجوداً.
 * كل واحدة زبون ضائع وإشارة سيئة لـ Google. العلاج: تحويل 301 إلى أقرب صفحة حية — والتحويل في Shopify يشمل كل مجلدات اللغات.
 */
const STOP = new Set(['products', 'product', 'pages', 'page', 'collections', 'collection', 'fr', 'ar', 'en', 'view', 'lp', 'www', 'html']);
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const tokens = (s) =>
  new Set(
    decode(String(s || ''))
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

/** الصفحات الحية التي يمكن التحويل إليها: المنتجات النشطة، صفحات الهبوط المنشورة، صفحات المتجر، الرئيسية */
export function linkTargets(projectId) {
  const out = [{ kind: 'home', target: '/', label: null }];
  for (const p of db.prepare("SELECT title, handle FROM products WHERE project_id = ? AND handle IS NOT NULL AND handle != '' AND shopify_id IS NOT NULL AND COALESCE(shopify_status, 'ACTIVE') = 'ACTIVE' ORDER BY title").all(projectId))
    out.push({ kind: 'product', target: `/products/${decode(p.handle)}`, label: p.title, words: [p.title, p.handle] });
  for (const l of db.prepare("SELECT l.angle, l.target_url, l.public_path, p.title FROM landing_pages l LEFT JOIN products p ON p.id = l.product_id WHERE l.project_id = ? AND l.status = 'published'").all(projectId)) {
    const target = l.target_url || l.public_path;
    if (target) out.push({ kind: 'landing', target, label: `${l.title || ''} · ${l.angle}`.replace(/^ · /, ''), words: [l.title, l.angle, l.public_path] });
  }
  for (const s of db.prepare("SELECT title, path FROM store_pages WHERE project_id = ? AND kind = 'page' AND published = 1 AND gone = 0").all(projectId)) out.push({ kind: 'page', target: s.path, label: s.title || s.path, words: [s.title, s.path] });
  return out;
}

/** أقرب صفحة حية لرابط مكسور: أكثر كلمات مشتركة مع اسم المنتج ورابطه (ترموس، ميكي، 320…)، وإلا الرئيسية */
export function suggestTarget(path, targets) {
  const want = tokens(path);
  let best = targets[0];
  let score = 0;
  for (const t of targets) {
    if (!t.words) continue;
    const have = tokens(t.words.join(' '));
    let s = 0;
    for (const w of want) if (have.has(w)) s++;
    // المنتج قبل صفحة الهبوط عند التعادل: الرابط القديم كان صفحة منتج
    if (s > score || (s === score && s > 0 && best.kind !== 'product' && t.kind === 'product')) {
      best = t;
      score = s;
    }
  }
  return best.target;
}

const productHandleOf = (target) => {
  const path = decode(String(target || '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0])
    .toLowerCase()
    .replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/, '');
  const m = /^\/products\/([^/]+)\/?$/.exec(path);
  return m ? m[1] : null;
};

export async function brokenLinks(projectId, { days = 30 } = {}) {
  const since = addDays(dzDay(), -(Math.min(Math.max(Number(days) || 30, 1), 365) - 1));
  const targets = linkTargets(projectId);
  const hits = db
    .prepare(
      `SELECT page, COUNT(DISTINCT visitor) AS visitors, SUM(views) AS views, MAX(last_at) AS last_at FROM page_visits
       WHERE project_id = ? AND day >= ? AND page_type = '404' GROUP BY page ORDER BY visitors DESC, views DESC LIMIT 100`,
    )
    .all(projectId, since);
  const cfg = projectConfig(projectId);
  let redirects = [];
  let error = null;
  if (shopify.isConfigured(cfg)) {
    try {
      redirects = await shopify.listUrlRedirects(cfg);
    } catch (e) {
      error = e.message;
    }
  }
  const live = new Set(targets.filter((t) => t.kind === 'product').map((t) => t.target.slice('/products/'.length).toLowerCase()));
  const byPath = new Map(redirects.map((r) => [pageKey(r.path), r]));
  const dead = redirects
    .filter((r) => {
      const h = productHandleOf(r.target);
      return h && !live.has(h);
    })
    .map((r) => ({ id: r.id, path: decode(r.path), target: decode(r.target), suggestion: suggestTarget(`${r.path} ${r.target}`, targets) }));
  return {
    days: Number(days) || 30,
    shopify: shopify.isConfigured(cfg),
    error,
    hits: hits.map((h) => ({ ...h, redirect: byPath.get(h.page)?.target ? decode(byPath.get(h.page).target) : null, suggestion: suggestTarget(h.page, targets) })),
    dead,
    targets: targets.map(({ words, ...t }) => t),
  };
}

/** تحويل 301 من رابط مكسور إلى صفحة حية (أو تصحيح تحويل يشير إلى منتج محذوف) */
export async function fixLink(projectId, { path, target }) {
  const from = String(path || '').trim();
  const to = String(target || '').trim();
  if (!/^\/\S{0,500}$/.test(from) || from === '/') throw badRequest('path_invalid');
  if (!/^\/\S{0,250}$/.test(to)) throw badRequest('target_invalid');
  if (pageKey(from) === pageKey(to)) throw badRequest('target_same_as_path');
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg)) throw badRequest('shopify_not_configured');
  // Shopify يخزّن المسار مرمّزاً (حروف عربية): نرمّز ما لم يُرمَّز بعد
  const encoded = encodeURI(decode(from));
  const dest = encodeURI(decode(to));
  const existing = await shopify.findUrlRedirect(cfg, encoded);
  return existing ? shopify.updateUrlRedirect(cfg, existing.id, encoded, dest) : shopify.createUrlRedirect(cfg, encoded, dest);
}

// ——— فحص رابط الإعلان ———
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
/** عنوان عام فقط (https باسم نطاق، لا IP ولا اسم داخلي ولا منفذ): الـ ERP لا يفتح شبكته الداخلية بطلب من المستخدم */
const publicHttps = (u) => u.protocol === 'https:' && !u.port && !u.username && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname) && !/\.(local|internal|lan|home|localhost)$/i.test(u.hostname);
const bareHost = (h) => String(h || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
const pathOf = (u) => decode(u.pathname).replace(/\/+$/, '') || '/';

/** معرّفات البيكسل في الصفحة: إعدادات القالب، fbq('init')، صورة noscript، أو إعدادات بيكسل تطبيق في Shopify */
export function pixelIdsIn(html) {
  const ids = new Set();
  for (const re of [/pixelId["']?\s*:\s*["'](\d{6,20})["']/g, /fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/g, /facebook\.com\/tr\/?\?id=(\d{6,20})/g, /pixel_?id\\*["']\s*:\s*\\*["'](\d{6,20})/gi])
    for (const m of String(html).matchAll(re)) ids.add(m[1]);
  return [...ids];
}

/** موانع الإطلاق: لا زائر يصل إلى صفحة تعمل. البقية (البيكسل، التحويلات، السرعة…) تنبيهات تُعرض للتاجر */
export const LINK_BLOCKERS = new Set(['not_found', 'http_error', 'redirect_loop', 'redirect_unsafe', 'sold_out']);

/**
 * يفتح رابط الإعلان كما يفتحه زائر من هاتفه: الوجهة النهائية والتحويلات، الرابط الأساسي (canonical)، البيكسل، نموذج الطلب، التوفر، السرعة.
 * مؤشرات Meta (مشاهدة الصفحة بعد النقر، تكلفة النتيجة، ما تتعلمه الخوارزمية) تُحسب على هذه الصفحة: رابط مكسور أو تحويل يضيّع النقرة المدفوعة.
 * ok: true لا مانع، false فيه مانع (LINK_BLOCKERS)، null تعذّر الفحص (لا يُمنع الإطلاق بسببه).
 */
export async function checkAdLink(projectId, link, { pixelId } = {}) {
  const cfg = projectConfig(projectId);
  let start;
  try {
    start = new URL(String(link || '').trim());
  } catch {
    throw badRequest('link_invalid');
  }
  if (!publicHttps(start)) throw badRequest('link_invalid');
  const problems = [];
  const add = (code, level, params) => problems.push(params ? { code, level, params } : { code, level });
  const hops = [];
  let url = start;
  let res;
  let unsafe = null;
  const t0 = Date.now();
  try {
    for (let i = 0; i < 6; i++) {
      res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': MOBILE_UA, 'accept-language': 'ar-DZ,ar;q=0.9,fr;q=0.8' }, signal: AbortSignal.timeout(15000) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      const next = new URL(loc, url);
      hops.push({ status: res.status, to: next.href });
      if (!publicHttps(next)) {
        unsafe = next.href;
        break;
      }
      url = next;
    }
  } catch {
    return { ok: null, url: start.href, problems: [{ code: 'unreachable', level: 'warn' }] };
  }
  const html = res.ok ? (await res.text()).slice(0, 3e6) : '';
  const ms = Date.now() - t0;
  if (unsafe) add('redirect_unsafe', 'high', { to: unsafe });
  else if (res.status === 404) add('not_found', 'high');
  else if (res.status >= 300 && res.status < 400) add('redirect_loop', 'high');
  else if (res.status >= 400) add('http_error', 'high', { status: res.status });
  if (hops.length) add(bareHost(url.hostname) === bareHost(start.hostname) ? 'redirect' : 'redirect_other_domain', 'warn', { to: url.href });
  const store = bareHost(cfg.store_domain);
  if (store && bareHost(url.hostname) !== store) add('not_store_domain', 'warn', { store });
  const canonicalRaw = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1] || null;
  let canonical = null;
  try {
    canonical = canonicalRaw ? new URL(canonicalRaw.replace(/&amp;/g, '&'), url) : null;
  } catch {
    canonical = null;
  }
  if (res.ok && canonical && pathOf(canonical) !== pathOf(url)) add('canonical_mismatch', 'warn', { canonical: canonical.href });
  const pixels = pixelIdsIn(html);
  const expected = String(pixelId || cfg.meta_pixel_id || '');
  if (res.ok && !pixels.length) add('pixel_missing', 'high');
  else if (res.ok && expected && !pixels.includes(expected)) add('pixel_mismatch', 'high', { expected, found: pixels.join(', ') });
  const product = /\/products\//.test(url.pathname);
  const hasForm = /data-lead-form|data-erp-lp|action=["'][^"']*\/cart\/add/i.test(html);
  if (res.ok && product && !hasForm) add('form_missing', 'warn');
  if (res.ok && /<meta[^>]+property=["']product:availability["'][^>]+content=["']out of stock["']/i.test(html)) add('sold_out', 'high');
  if (ms > 3000) add('slow', 'warn', { ms });
  if (/[?&]utm_/i.test(start.search)) add('params_in_link', 'info');
  return {
    ok: !problems.some((p) => LINK_BLOCKERS.has(p.code)),
    url: start.href,
    final_url: url.href,
    status: res.status,
    hops,
    ms,
    canonical: canonical?.href || null,
    pixels,
    has_form: hasForm,
    problems,
  };
}

/** الرابط الذي يوضع في الإعلان: الصفحة نفسها دون معاملات التتبّع (تذهب إلى «معاملات URL» في Meta) */
export function cleanAdLink(link) {
  try {
    const u = new URL(String(link).trim());
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ttclid$)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return link;
  }
}
