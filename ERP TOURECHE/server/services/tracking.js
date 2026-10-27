import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { SHIPPED_EVER } from '../lib/statuses.js';
import { addDays, dzDay, dzDayStartIso, nowIso, round } from '../lib/util.js';
import { inList } from './projects.js';

/**
 * عدّاد الزوار المخفي على كل صفحات المتجر (سنيبت القالب → navigator.sendBeacon → هنا):
 * صف واحد لكل (صفحة، زائر، يوم جزائري) مع عدد المشاهدات وبدء النموذج ومصدر الزيارة.
 * الطلبية تُنسب للصفحة التي أُرسل منها النموذج (landing_url = رابط الصفحة عند الإرسال)،
 * لا لـ utm_content: نموذج الطلب يحفظ آخر UTM في المتصفح فيبقى قديماً بعد تنقّل الزائر بين الصفحات.
 */

// «Cubot» هاتف يباع في الجزائر: «bot» وحدها كانت تعدّه روبوتاً
export const BOT_UA =
  /(?<!cu)bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-external|facebot|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|whatsapp|telegram|discord|slack|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|scrapy|phantom|selenium|puppeteer|playwright/i;

const LOCALE = /^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i;

/** مفتاح الصفحة الموحّد (للزيارات وللطلبيات): المسار دون اللغة، بأحرف صغيرة، + ‎?view=‎ إن وُجد */
export function pageKey(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(String(raw), 'https://store.invalid');
  } catch {
    return null;
  }
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* رابط مشوّه: يبقى كما هو */
  }
  path = path
    .replace(LOCALE, '')
    // ‎/collections/x/products/y‎ هي صفحة المنتج نفسها
    .replace(/^\/collections\/[^/]+(?=\/products\/)/i, '')
    .replace(/\/+$/, '');
  path = (path || '/').toLowerCase().slice(0, 300);
  const view = String(u.searchParams.get('view') || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
  return view ? `${path}?view=${view}` : path;
}

/** من أين جاء الزائر: إعلان (Meta/Google/TikTok/حملة)، شبكات، بحث، تنقّل داخل المتجر، مباشر */
export function sourceOf(params, referrer, storeHost) {
  const s = String(params.get('utm_source') || '').toLowerCase();
  if (params.has('fbclid') || /^(fb|ig|an|msg)$|facebook|instagram|meta|messenger/.test(s)) return 'meta';
  if (params.has('gclid') || params.has('gbraid') || params.has('wbraid') || /google|adwords|youtube/.test(s)) return 'google';
  if (params.has('ttclid') || /tiktok/.test(s)) return 'tiktok';
  if (s) return 'campaign';
  let host = '';
  try {
    host = new URL(String(referrer || '')).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (!host) return 'direct';
  if ((storeHost && (host === storeHost || host.endsWith(`.${storeHost}`))) || host.endsWith('.myshopify.com') || host === 'shop.app') return 'internal';
  if (/(^|\.)(facebook|fb|instagram|messenger|tiktok|whatsapp|youtube|snapchat|pinterest|t)\.(com|me|co)$|^l\.facebook|^lm\.facebook/.test(host)) return 'social';
  if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex|ecosia|qwant)\./.test(host)) return 'search';
  return 'other';
}

const projectBySlug = (slug) => db.prepare('SELECT id, domain FROM projects WHERE slug = ? AND active = 1').get(String(slug || '').toLowerCase());

/**
 * زيارة أو بدء نموذج من السنيبت. يُرجع false دون خطأ لكل ما لا يُعدّ (روبوت، مشروع مجهول، بيانات ناقصة):
 * نقطة عامة، فلا نكشف شيئاً للمرسل.
 */
export function recordVisit(projectSlug, body, userAgent = '') {
  if (!/^[a-z0-9-]{1,40}$/i.test(String(projectSlug || ''))) return false;
  if (!userAgent || BOT_UA.test(userAgent)) return false;
  const project = projectBySlug(projectSlug);
  if (!project) return false;
  const b = body && typeof body === 'object' ? body : {};
  const event = b.e === 'f' ? 'f' : b.e === 'v' ? 'v' : null;
  const raw = typeof b.u === 'string' ? b.u.slice(0, 1500) : '';
  if (!event || !raw) return false;
  const page = pageKey(raw);
  if (!page) return false;
  let params;
  try {
    params = new URL(raw, 'https://store.invalid').searchParams;
  } catch {
    return false;
  }
  const visitor = /^[a-f0-9]{16}$/.test(String(b.vid || '')) ? b.vid : crypto.randomBytes(8).toString('hex');
  const storeHost = String(project.domain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .toLowerCase();
  const source = event === 'v' ? sourceOf(params, typeof b.r === 'string' ? b.r.slice(0, 500) : '', storeHost) : null;
  const ab = /^[a-z0-9-]{1,40}\.[A-F]$/i.test(String(params.get('erp_v') || '')) ? params.get('erp_v').toLowerCase() : null;
  const at = nowIso();
  db.prepare(
    `INSERT INTO page_visits (project_id, day, page, visitor, views, form, from_ad, source, campaign, ab, page_type, first_at, last_at)
     VALUES (@project_id, @day, @page, @visitor, @views, @form, @from_ad, @source, @campaign, @ab, @page_type, @at, @at)
     ON CONFLICT(project_id, day, page, visitor) DO UPDATE SET
       views = views + excluded.views,
       form = MAX(form, excluded.form),
       from_ad = MAX(from_ad, excluded.from_ad),
       source = CASE WHEN source IS NULL OR (source IN ('internal','direct') AND excluded.source IS NOT NULL) THEN excluded.source ELSE source END,
       campaign = COALESCE(campaign, excluded.campaign),
       ab = COALESCE(ab, excluded.ab),
       page_type = COALESCE(page_type, excluded.page_type),
       last_at = excluded.last_at`,
  ).run({
    project_id: project.id,
    day: dzDay(),
    page,
    visitor,
    views: event === 'v' ? 1 : 0,
    form: event === 'f' ? 1 : 0,
    from_ad: ['meta', 'google', 'tiktok', 'campaign'].includes(source) ? 1 : 0,
    source,
    campaign: params.get('utm_campaign') ? String(params.get('utm_campaign')).slice(0, 120) : null,
    ab,
    page_type: /^[a-z0-9_/-]{1,30}$/.test(String(b.t || '')) ? b.t : null,
    at,
  });
  return true;
}

/** الحذف بعد 400 يوم (سنة كاملة للمقارنة الموسمية) */
export function pruneVisits(keepDays = 400) {
  return db.prepare('DELETE FROM page_visits WHERE day < ?').run(addDays(dzDay(), -keepDays)).changes;
}

const range = (days) => {
  const to = dzDay();
  const from = addDays(to, -(Math.max(1, days) - 1));
  return { from, to, days: Math.max(1, days), startIso: dzDayStartIso(from) };
};

/** زوار صفحة (أو نسخة A/B) منذ يوم معيّن: ab = 'slug.L' لزوار رابط الاختبار، أو page + direct لزوار الصفحة دون الاختبار */
export function visitorsWhere(projectId, { page, ab, direct = false, sinceDay }) {
  const args = [projectId, sinceDay];
  let where = 'project_id = ? AND day >= ?';
  if (ab) {
    where += ' AND ab = ?';
    args.push(ab.toLowerCase());
  }
  if (page) {
    where += ' AND page = ?';
    args.push(page);
  }
  if (direct) where += ' AND ab IS NULL';
  const r = db.prepare(`SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT CASE WHEN from_ad = 1 THEN visitor END) AS from_ad, COUNT(DISTINCT CASE WHEN form = 1 THEN visitor END) AS form FROM page_visits WHERE ${where}`).get(...args);
  return { visitors: r.visitors || 0, from_ad: r.from_ad || 0, form: r.form || 0 };
}

const ORDER_OK = "status NOT IN ('abandoned','fake')";
const CONFIRMED = ['confirmed', ...SHIPPED_EVER];

/** الطلبيات حسب الصفحة التي أُرسلت منها (landing_url) */
function ordersByPage(projectIds, startIso) {
  const out = new Map();
  const rows = db
    .prepare(`SELECT project_id, status, total, landing_url FROM orders WHERE project_id IN (${inList(projectIds)}) AND created_at >= ? AND landing_url IS NOT NULL AND landing_url != ''`)
    .all(...projectIds, startIso);
  for (const o of rows) {
    const key = pageKey(o.landing_url);
    if (!key) continue;
    const k = `${o.project_id}|${key}`;
    const e = out.get(k) || { orders: 0, confirmed: 0, delivered: 0, returned: 0, abandoned: 0, revenue: 0 };
    if (o.status === 'abandoned') e.abandoned++;
    else if (o.status !== 'fake') {
      e.orders++;
      if (CONFIRMED.includes(o.status)) e.confirmed++;
      if (o.status === 'delivered') {
        e.delivered++;
        e.revenue += o.total || 0;
      }
      if (o.status === 'returned') e.returned++;
    }
    out.set(k, e);
  }
  return out;
}

const decodeHandle = (h) => {
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
};

/** اسم مفهوم لكل صفحة: زاوية صفحة الهبوط، اسم المنتج، المجموعة، الرئيسية… */
function labeler(projectIds) {
  const landings = new Map(
    db
      .prepare(`SELECT l.id, l.project_id, l.slug, l.angle, l.product_id, p.title AS product_title FROM landing_pages l LEFT JOIN products p ON p.id = l.product_id WHERE l.project_id IN (${inList(projectIds)})`)
      .all(...projectIds)
      .map((l) => [`${l.project_id}|lp-${l.slug.toLowerCase()}`, l]),
  );
  const products = new Map(
    db
      .prepare(`SELECT id, project_id, title, handle FROM products WHERE project_id IN (${inList(projectIds)}) AND handle IS NOT NULL AND handle != ''`)
      .all(...projectIds)
      .map((p) => [`${p.project_id}|${decodeHandle(p.handle).toLowerCase()}`, p]),
  );
  const pinned = new Map(
    db
      .prepare(`SELECT project_id, url, title FROM store_pages WHERE project_id IN (${inList(projectIds)})`)
      .all(...projectIds)
      .map((s) => [`${s.project_id}|${pageKey(s.url)}`, s.title]),
  );
  return (projectId, key) => {
    const [path, view] = key.split('?view=');
    const handle = path.startsWith('/products/') ? path.slice('/products/'.length) : null;
    const product = handle ? products.get(`${projectId}|${handle}`) : null;
    if (view) {
      const l = landings.get(`${projectId}|${view}`);
      if (l) return { kind: 'landing', label: l.angle, sub: l.product_title || product?.title || handle, landing_id: l.id, product_id: l.product_id };
      return { kind: 'template', label: view, sub: product?.title || handle, product_id: product?.id || null };
    }
    if (product) return { kind: 'product', label: product.title, sub: null, product_id: product.id };
    if (handle) return { kind: 'product', label: handle, sub: null, product_id: null };
    if (path === '/') return { kind: 'home', label: null, sub: null };
    if (path.startsWith('/collections')) return { kind: 'collection', label: pinned.get(`${projectId}|${key}`) || (path === '/collections' ? null : path.slice('/collections/'.length)), sub: null };
    if (path.startsWith('/pages/')) return { kind: 'page', label: pinned.get(`${projectId}|${key}`) || path.slice('/pages/'.length), sub: null };
    return { kind: 'other', label: pinned.get(`${projectId}|${key}`) || path, sub: null };
  };
}

/** أرقام كل صفحة في آخر N يوماً (للقوائم: صفحات المتجر، صفحات الهبوط): دالة (المشروع، مفتاح الصفحة) ← الأرقام */
export function metricsByPage(projectIds, days = 30) {
  const r = range(days);
  const visits = new Map(
    db
      .prepare(
        `SELECT project_id, page, COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT CASE WHEN form = 1 THEN visitor END) AS form
         FROM page_visits WHERE project_id IN (${inList(projectIds)}) AND day >= ? GROUP BY project_id, page`,
      )
      .all(...projectIds, r.from)
      .map((v) => [`${v.project_id}|${v.page}`, v]),
  );
  const orders = ordersByPage(projectIds, r.startIso);
  return (projectId, key) => {
    const v = visits.get(`${projectId}|${key}`) || { visitors: 0, form: 0 };
    const o = orders.get(`${projectId}|${key}`) || { orders: 0, confirmed: 0, delivered: 0, returned: 0 };
    const closed = o.delivered + o.returned;
    return {
      days: r.days,
      visitors: v.visitors,
      form: v.form,
      orders: o.orders,
      confirmed: o.confirmed,
      delivered: o.delivered,
      returned: o.returned,
      conversion: v.visitors ? round((100 * o.orders) / v.visitors, 2) : null,
      delivery_rate: closed ? round((100 * o.delivered) / closed) : null,
    };
  };
}

/** قناة الطلبية (آخر لمسة): معاملات رابط الصفحة التي أُرسل منها النموذج (fbclid، gclid، utm_source…) ثم utm_source المحفوظ */
export function orderChannel(o) {
  if (o.source === 'manual' && !o.landing_url) return 'manual';
  let params = new URLSearchParams();
  if (o.landing_url) {
    try {
      params = new URL(String(o.landing_url), 'https://store.invalid').searchParams;
    } catch {
      /* رابط مشوّه */
    }
  }
  if (!params.get('utm_source') && o.utm_source) params.set('utm_source', String(o.utm_source));
  const ch = sourceOf(params, null, null);
  // دون رابط صفحة: طلبيات الجدول أو القديمة — لا نعرف من أين جاءت
  return ch === 'direct' && !o.landing_url ? 'unknown' : ch;
}

/**
 * لوحة القيادة ← المصادر: طلبيات الفترة حسب الصفحة التي أُرسلت منها (مع زوارها في الفترة نفسها والتحويل) وحسب القناة.
 * orders = طلبيات الفترة دون المتروكة (كما في analytics.stats)؛ المزيفة لا تُحسب.
 */
export function sourcesReport(projectIds, orders, fromDay, toDay) {
  const blank = () => ({ orders: 0, confirmed: 0, delivered: 0, returned: 0, revenue: 0 });
  const count = (e, o) => {
    e.orders++;
    if (CONFIRMED.includes(o.status)) e.confirmed++;
    if (o.status === 'delivered') {
      e.delivered++;
      e.revenue += o.total || 0;
    }
    if (o.status === 'returned') e.returned++;
  };
  const pages = new Map();
  const channels = new Map();
  for (const o of orders) {
    if (o.status === 'fake' || o.status === 'abandoned') continue;
    const key = pageKey(o.landing_url);
    const k = key ? `${o.project_id}|${key}` : 'none';
    const p = pages.get(k) || { project_id: key ? o.project_id : null, key, visitors: 0, ...blank() };
    count(p, o);
    pages.set(k, p);
    const ch = orderChannel(o);
    const c = channels.get(ch) || { source: ch, ...blank() };
    count(c, o);
    channels.set(ch, c);
  }
  const visits = db
    .prepare(`SELECT project_id, page, COUNT(DISTINCT visitor) AS visitors FROM page_visits WHERE project_id IN (${inList(projectIds)}) AND day >= ? AND day <= ? GROUP BY project_id, page`)
    .all(...projectIds, fromDay, toDay);
  for (const v of visits) {
    const k = `${v.project_id}|${v.page}`;
    if (pages.has(k)) pages.get(k).visitors = v.visitors;
    // صفحة زارها كثيرون ولم تأتِ منها طلبية: تستحق النظر
    else if (v.visitors >= 5) pages.set(k, { project_id: v.project_id, key: v.page, visitors: v.visitors, ...blank() });
  }
  const label = labeler(projectIds);
  const rate = (x) => (x.delivered + x.returned ? round((100 * x.delivered) / (x.delivered + x.returned)) : null);
  return {
    pages: [...pages.values()]
      .map((p) => ({
        ...p,
        ...(p.key ? label(p.project_id, p.key) : { kind: 'none', label: null, sub: null }),
        revenue: round(p.revenue),
        conversion: p.visitors ? round((100 * p.orders) / p.visitors, 2) : null,
        delivery_rate: rate(p),
      }))
      .sort((a, b) => b.orders - a.orders || b.visitors - a.visitors)
      .slice(0, 40),
    channels: [...channels.values()].map((c) => ({ ...c, revenue: round(c.revenue), delivery_rate: rate(c) })).sort((a, b) => b.orders - a.orders),
  };
}

/** آخر زيارة وصلت وعدد زيارات آخر 24 ساعة: هل العدّاد يعمل فعلاً؟ */
export function trackingHealth(projectIds) {
  const r = db
    .prepare(`SELECT MAX(last_at) AS last_at, COUNT(DISTINCT CASE WHEN last_at >= ? THEN visitor END) AS visitors_24h FROM page_visits WHERE project_id IN (${inList(projectIds)}) AND day >= ?`)
    .get(new Date(Date.now() - 86400e3).toISOString(), ...projectIds, addDays(dzDay(), -30));
  return { last_visit_at: r.last_at || null, visitors_24h: r.visitors_24h || 0 };
}

/**
 * تقرير الزيارات والتحويل لكل صفحة: الزوار (فريدون)، من بدأ النموذج، الطلبيات، التحويل، المسلّمة.
 * يشمل كل صفحة زارها أحد أو جاءت منها طلبية في الفترة.
 */
export function trafficReport(projectIds, { days = 30 } = {}) {
  const r = range(Math.min(Math.max(Number(days) || 30, 1), 365));
  const P = inList(projectIds);
  const visits = db
    .prepare(
      `SELECT project_id, page, COUNT(DISTINCT visitor) AS visitors, SUM(views) AS views, COUNT(DISTINCT CASE WHEN form = 1 THEN visitor END) AS form,
         COUNT(DISTINCT CASE WHEN from_ad = 1 THEN visitor END) AS from_ad
       FROM page_visits WHERE project_id IN (${P}) AND day >= ? GROUP BY project_id, page`,
    )
    .all(...projectIds, r.from);
  const orders = ordersByPage(projectIds, r.startIso);
  const label = labeler(projectIds);
  const rows = new Map();
  const empty = { visitors: 0, views: 0, form: 0, from_ad: 0, orders: 0, confirmed: 0, delivered: 0, returned: 0, abandoned: 0, revenue: 0 };
  for (const v of visits) rows.set(`${v.project_id}|${v.page}`, { ...empty, project_id: v.project_id, key: v.page, visitors: v.visitors, views: v.views || 0, form: v.form, from_ad: v.from_ad });
  for (const [k, o] of orders) {
    const [pid, ...rest] = k.split('|');
    const key = rest.join('|');
    rows.set(k, { ...(rows.get(k) || { ...empty, project_id: Number(pid), key }), ...o });
  }
  const pages = [...rows.values()]
    .map((x) => {
      const closed = x.delivered + x.returned;
      return {
        ...x,
        ...label(x.project_id, x.key),
        revenue: round(x.revenue),
        conversion: x.visitors ? round((100 * x.orders) / x.visitors, 2) : null,
        form_rate: x.visitors ? round((100 * x.form) / x.visitors, 1) : null,
        // من بدأ النموذج ولم يطلب: احتكاك في النموذج (سعر التوصيل، حقول، ثقة)
        form_to_order: x.form ? round((100 * Math.min(x.orders, x.form)) / x.form, 1) : null,
        delivery_rate: closed ? round((100 * x.delivered) / closed) : null,
      };
    })
    .sort((a, b) => b.visitors - a.visitors || b.orders - a.orders);

  const tot = db
    .prepare(
      `SELECT COUNT(DISTINCT visitor) AS visitors, SUM(views) AS views, COUNT(DISTINCT CASE WHEN form = 1 THEN visitor END) AS form, COUNT(DISTINCT CASE WHEN from_ad = 1 THEN visitor END) AS from_ad
       FROM page_visits WHERE project_id IN (${P}) AND day >= ?`,
    )
    .get(...projectIds, r.from);
  const ord = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${CONFIRMED.map(() => 'status = ?').join(' OR ')}), 0) AS confirmed, COALESCE(SUM(status = 'delivered'), 0) AS delivered FROM orders WHERE project_id IN (${P}) AND created_at >= ? AND ${ORDER_OK}`)
    .get(...CONFIRMED, ...projectIds, r.startIso);
  const tracked = [...orders.values()].reduce((s, o) => s + o.orders, 0);

  // الزوار حسب المصدر (أول مصدر غير داخلي لكل زائر في اليوم)
  const sources = db
    .prepare(`SELECT COALESCE(source, 'direct') AS source, COUNT(DISTINCT visitor) AS visitors FROM page_visits WHERE project_id IN (${P}) AND day >= ? AND views > 0 GROUP BY COALESCE(source, 'direct') ORDER BY visitors DESC`)
    .all(...projectIds, r.from);

  // يومياً: زوار فريدون في اليوم + طلبيات اليوم
  const daily = new Map();
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) daily.set(d, { day: d, visitors: 0, orders: 0 });
  for (const v of db.prepare(`SELECT day, COUNT(DISTINCT visitor) AS n FROM page_visits WHERE project_id IN (${P}) AND day >= ? GROUP BY day`).all(...projectIds, r.from)) if (daily.has(v.day)) daily.get(v.day).visitors = v.n;
  for (const o of db.prepare(`SELECT created_at FROM orders WHERE project_id IN (${P}) AND created_at >= ? AND ${ORDER_OK}`).all(...projectIds, r.startIso)) {
    const d = daily.get(dzDay(o.created_at));
    if (d) d.orders++;
  }

  return {
    from: r.from,
    to: r.to,
    days: r.days,
    totals: {
      visitors: tot.visitors || 0,
      views: tot.views || 0,
      form: tot.form || 0,
      from_ad: tot.from_ad || 0,
      orders: ord.n,
      confirmed: ord.confirmed,
      delivered: ord.delivered,
      orders_with_page: tracked,
      conversion: tot.visitors ? round((100 * ord.n) / tot.visitors, 2) : null,
      form_rate: tot.visitors ? round((100 * (tot.form || 0)) / tot.visitors, 1) : null,
    },
    sources,
    daily: [...daily.values()],
    pages,
    health: trackingHealth(projectIds),
  };
}
