import { db, parseJson } from '../db/index.js';
import * as shopify from '../integrations/shopify.js';
import { request } from '../lib/http.js';
import { projectConfig } from '../lib/settings.js';
import { badRequest, daysBetween, nowIso } from '../lib/util.js';
import { storeBase } from './pages.js';

/**
 * أسعار التوصيل وسياسات المتجر كما يراها الزبون، ليستعملها الـ ERP (صفحات الهبوط أولاً):
 *  - الأسعار من مصدرها: إعداد القالب shipping_table (السطر: الرمز|الولاية|المنزل|المكتب|المدة)، وهو نفسه الذي يقرأ منه
 *    فورم الطلب وصفحة «أسعار التوصيل». إن تعذّرت قراءة القالب: جدول الصفحة العامة /pages/delivery.
 *  - السياسات من صفحات Shopify العامة: /policies/shipping-policy و/policies/refund-policy (المعاينة، الاسترجاع، الاستبدال).
 *  - مدة التوصيل لا تُخمَّن: يكتبها التاجر، والـ ERP يقترح المدة المقاسة من طلبياته المسلّمة.
 * الـ ERP لا يغيّر الأسعار: التعديل يبقى في Shopify ثم «تحديث من المتجر».
 */

const DELIVERY_PAGE = '/pages/delivery';
const POLICY_PAGES = {
  shipping: '/policies/shipping-policy',
  refund: '/policies/refund-policy',
};

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  middot: '·',
  ndash: '–',
  mdash: '—',
};
const decode = (s) =>
  String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** HTML → نص بأسطر (فقرة/عنصر قائمة لكل سطر) */
export function htmlText(html) {
  return decode(
    String(html || '')
      .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|tr|ol|ul)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((l) => l && l !== '•')
    .join('\n');
}

// «DA 1,200» / «1 200,00 DA» / «1200» → 1200. فارغ أو «غير متوفر» = لا توصيل، وليس مجاناً
const price = (v) => {
  const m = /\d[\d\s.,]*/.exec(String(v ?? ''));
  return m
    ? Number(
        m[0]
          .trim()
          .replace(/[.,]\d{2}$/, '')
          .replace(/\D/g, ''),
      )
    : null;
};

/** إعداد القالب shipping_table: «01|أدرار|1200|700|» (المنزل ثم المكتب ثم المدة) */
export function parseShippingTable(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const p = line.split('|').map((x) => x.trim());
    const code = Number(p[0]);
    if (p.length < 2 || !Number.isInteger(code) || code < 1 || code > 99 || !p[1]) continue;
    rows.push({
      code,
      name: p[1],
      home: price(p[2]),
      desk: price(p[3]),
      eta: p[4] || '',
    });
  }
  return rows;
}

/** جدول صفحة «أسعار التوصيل» العامة: الأعمدة تُعرف من رؤوسها (مكتب/منزل)، وإلا الترتيب الافتراضي للقالب */
export function parseDeliveryHtml(html) {
  const table = /<table[\s\S]*?<\/table>/i.exec(String(html || ''))?.[0];
  if (!table) return [];
  const rowsHtml = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const cells = (tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map((c) => htmlText(c).replace(/\n/g, ' ').trim());
  let desk = 2;
  let home = 3;
  let eta = -1;
  const out = [];
  for (const tr of rowsHtml) {
    const c = cells(tr);
    if (/<th[^>]*scope="col"|<thead/i.test(tr) || (!/^\d+$/.test(c[0] || '') && c.length >= 3)) {
      const idx = (re) => c.findIndex((x) => re.test(x));
      if (idx(/مكتب|bureau|desk|stop/i) >= 0) desk = idx(/مكتب|bureau|desk|stop/i);
      if (idx(/منزل|domicile|home|الدار/i) >= 0) home = idx(/منزل|domicile|home|الدار/i);
      eta = idx(/مدة|délai|delai|eta/i);
      continue;
    }
    const code = Number(c[0]);
    if (!Number.isInteger(code) || code < 1 || !c[1]) continue;
    out.push({
      code,
      name: c[1],
      home: price(c[home]),
      desk: price(c[desk]),
      eta: eta >= 0 ? c[eta] || '' : '',
    });
  }
  return out;
}

/** نص سياسة Shopify من صفحتها العامة (/policies/…) */
export function policyText(html) {
  const src = String(html || '');
  const start = src.search(/class="[^"]*shopify-policy__body/);
  let body = start >= 0 ? src.slice(start) : (/<main[\s\S]*?<\/main>/i.exec(src)?.[0] ?? '');
  const end = body.search(/<\/main>/i);
  if (end > 0) body = body.slice(0, end);
  body = body.replace(/^[^>]*>/, '');
  return htmlText(body).slice(0, 6000);
}

async function fetchPage(url) {
  const { data } = await request('store', url, {
    headers: { Accept: 'text/html' },
    timeoutMs: 20000,
    retries: 1,
  });
  return typeof data === 'string' ? data : '';
}

const carriersFrom = (html) => {
  const m = /(?:شركات التوصيل|Transporteurs?|Carriers?)\s*:\s*([^<\n]{2,80})/i.exec(htmlText(html));
  return m ? m[1].trim() : null;
};

const isServed = (r) => r.home !== null || r.desk !== null;

export function summarizeRates(rates) {
  const range = (k) => {
    const v = rates
      .filter(isServed)
      .map((r) => r[k])
      .filter((x) => x !== null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  };
  // العدد على 58 ولاية (ما يعرفه الزبون وتعمل به شركات التوصيل؛ 59–69 تُشحن باسم ولايتها الأم) — كما يحسبه القالب
  const classic = rates.filter((r) => r.code <= 58);
  return {
    wilayas: rates.length,
    served: classic.filter(isServed).length,
    not_served: classic.filter((r) => !isServed(r)).map((r) => r.name),
    desk: range('desk'),
    home: range('home'),
  };
}

/** المدة المقاسة من الطلبيات المسلّمة (من الشحن إلى التسليم) — اقتراح للتاجر، لا تُنشر دون تأكيده */
export function measuredDelivery(projectId, days = 120) {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const rows = db
    .prepare("SELECT wilaya_code, shipped_at, delivered_at FROM orders WHERE project_id = ? AND status = 'delivered' AND shipped_at IS NOT NULL AND delivered_at >= ?")
    .all(projectId, since);
  const all = [];
  const byWilaya = {};
  for (const r of rows) {
    const d = daysBetween(r.shipped_at, r.delivered_at);
    if (d === null || d < 0 || d > 30) continue;
    all.push(d);
    if (r.wilaya_code) (byWilaya[r.wilaya_code] ||= []).push(d);
  }
  const q = (v, p) => {
    const s = [...v].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] * 10) / 10;
  };
  if (all.length < 10) return { count: all.length, enough: false };
  return {
    count: all.length,
    enough: true,
    days,
    median: q(all, 0.5),
    p80: q(all, 0.8),
    by_wilaya: Object.fromEntries(
      Object.entries(byWilaya)
        .filter(([, v]) => v.length >= 5)
        .map(([k, v]) => [k, { n: v.length, median: q(v, 0.5) }]),
    ),
  };
}

export function getDelivery(projectId) {
  const r = db.prepare('SELECT * FROM store_delivery WHERE project_id = ?').get(projectId);
  const rates = parseJson(r?.rates, []);
  return {
    project_id: projectId,
    rates,
    summary: summarizeRates(rates),
    policies: parseJson(r?.policies, {}),
    carriers: r?.carriers || null,
    free_from: r?.free_from ?? null,
    delivery_time: r?.delivery_time || '',
    source: r?.source || null,
    imported_at: r?.imported_at || null,
    measured: measuredDelivery(projectId),
  };
}

function save(projectId, fields) {
  const now = nowIso();
  db.prepare('INSERT INTO store_delivery (project_id, updated_at) VALUES (?, ?) ON CONFLICT(project_id) DO NOTHING').run(projectId, now);
  const keys = Object.keys(fields);
  db.prepare(`UPDATE store_delivery SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE project_id = ?`).run(...keys.map((k) => fields[k]), now, projectId);
}

/** «تحديث من المتجر»: الأسعار من القالب (أو الصفحة العامة) + نصوص السياسات */
export async function importDelivery(projectId) {
  const cfg = projectConfig(projectId);
  const base = storeBase(projectId);
  let rates = [];
  let source = null;
  let carriers = null;
  let freeFrom = null;
  if (shopify.isConfigured(cfg)) {
    try {
      const theme = await shopify.mainTheme(cfg);
      const [file] = theme ? await shopify.themeFiles(cfg, theme.id, ['config/settings_data.json']) : [];
      const cur = file?.content ? shopify.parseThemeJson(file.content).current : null;
      if (typeof cur?.shipping_table === 'string') {
        rates = parseShippingTable(cur.shipping_table);
        source = 'theme';
        carriers = String(cur.carrier_label || '').trim() || null;
        freeFrom = Number(cur.free_shipping_threshold) > 0 ? Number(cur.free_shipping_threshold) : null;
      }
    } catch {
      // دون read_themes (أو قالب بلا هذا الإعداد): الصفحة العامة تكفي (ولايات 1–58 فقط)
    }
  }
  const policies = {};
  if (base) {
    const page = await fetchPage(`${base}${DELIVERY_PAGE}`).catch(() => '');
    if (!rates.length && page) {
      rates = parseDeliveryHtml(page);
      if (rates.length) source = 'page';
    }
    carriers ||= carriersFrom(page);
    for (const [k, path] of Object.entries(POLICY_PAGES)) {
      const html = await fetchPage(`${base}${path}`).catch(() => '');
      const text = policyText(html);
      if (text.length > 40) policies[k] = text;
    }
  }
  if (!rates.length && !Object.keys(policies).length) throw badRequest(base ? 'delivery_import_empty' : 'store_domain_required');
  const cur = getDelivery(projectId);
  save(projectId, {
    rates: JSON.stringify(rates.length ? rates : cur.rates),
    policies: JSON.stringify({ ...cur.policies, ...policies }),
    carriers: carriers || cur.carriers,
    free_from: rates.length ? freeFrom : cur.free_from,
    source: source || cur.source,
    imported_at: nowIso(),
  });
  return getDelivery(projectId);
}

/** ما يكتبه التاجر: مدة التوصيل التي يلتزم بها أمام الزبون */
export function updateDelivery(projectId, input) {
  if (input.delivery_time !== undefined)
    save(projectId, {
      delivery_time:
        String(input.delivery_time || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200) || null,
    });
  return getDelivery(projectId);
}

const clip = (v, n) => String(v || '').slice(0, n);

/** معطيات التوصيل لكاتب صفحات الهبوط: حقائق فقط، وما لم يُذكر لا يُكتب */
export function deliveryFacts(projectId) {
  const d = getDelivery(projectId);
  if (!d.imported_at && !d.delivery_time) return null;
  const s = d.summary;
  return {
    carriers: d.carriers,
    wilayas_served: s.served || null,
    not_served: s.not_served,
    desk_price_from_da: s.desk?.min ?? null,
    home_price_from_da: s.home?.min ?? null,
    exact_price: 'يظهر في نموذج الطلب حسب الولاية ونوع التوصيل (مكتب أو منزل) قبل التأكيد',
    free_shipping_from_da: d.free_from,
    delivery_time: d.delivery_time || null,
    shipping_policy: clip(d.policies.shipping, 2500) || null,
    returns_policy: clip(d.policies.refund, 2500) || null,
  };
}
