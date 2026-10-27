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
