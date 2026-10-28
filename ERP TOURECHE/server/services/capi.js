import crypto from 'node:crypto';
import { db, parseJson } from '../db/index.js';
import * as meta from '../integrations/meta.js';
import { projectConfig } from '../lib/settings.js';
import { badRequest, nowIso } from '../lib/util.js';
import { wilayaByCode } from '../lib/wilayas.js';
import { enqueue } from './effects.js';

/**
 * ما بعد الطلبية إلى Meta (Conversions API). الطلبية نفسها («Purchase») يرسلها المتجر: البيكسل + n8n بنفس event_id.
 * الـ ERP يضيف ما لا يعرفه المتجر:
 *  - OrderConfirmed: أكّدها المؤكِّد بالهاتف (action_source = phone_call)
 *  - OrderDelivered: سُلّمت ودُفع ثمنها عند الباب (action_source = other)
 * كل حدث مربوط بالطلبية الأصلية (original_event_data: Purchase + event_id + order_id) فتنسبه Meta إلى الإعلان نفسه
 * ولو جاء بعد أيام، ويحمل هوية الزبون بنفس تجزئة المتجر (الهاتف 213…، الاسم، البلدية) وفق قواعد Meta.
 * وقت الحدث = لحظة التأكيد/التسليم (Meta ترفض ما مضى عليه أكثر من 7 أيام).
 */
export const ORDER_EVENTS = {
  confirmed: { setting: 'meta_capi_confirmed', name: (cfg) => cfg.meta_capi_confirmed_event || 'OrderConfirmed', action_source: 'phone_call' },
  delivered: { setting: 'meta_capi_delivered', name: (cfg) => cfg.meta_capi_event || 'OrderDelivered', action_source: 'other' },
};

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** الهاتف بصيغة Meta: أرقام فقط مع رمز البلد (213…) */
export const metaPhone = (p) => {
  const d = String(p || '')
    .replace(/\D/g, '')
    .replace(/^(?:00)?213/, '')
    .replace(/^0/, '');
  return /^[567]\d{8}$/.test(d) ? `213${d}` : null;
};
/** المدينة والولاية: حروف صغيرة دون نبرات ولا مسافات ولا رموز */
const place = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** هوية الزبون مجزّأة: كما يرسلها نموذج الطلب في المتجر (fn = الكلمة الأولى، ln = الباقي، external_id = الهاتف) + الولاية */
export function userData(o) {
  const ph = metaPhone(o.phone);
  const [first, ...rest] = String(o.customer_name || '').trim().split(/\s+/);
  const ct = place(o.commune_fr || o.commune);
  const st = place(wilayaByCode(o.wilaya_code)?.ascii);
  return {
    ...(ph ? { ph: [sha(ph)], external_id: [sha(ph)] } : {}),
    ...(first ? { fn: [sha(first.toLowerCase())] } : {}),
    ...(rest.length ? { ln: [sha(rest.join(' ').toLowerCase())] } : {}),
    ...(ct ? { ct: [sha(ct)] } : {}),
    ...(st ? { st: [sha(st)] } : {}),
    country: [sha('dz')],
  };
}

const unix = (iso) => Math.floor(Date.parse(iso || nowIso()) / 1000);

export function buildOrderEvent(o, kind, cfg, at = nowIso()) {
  const def = ORDER_EVENTS[kind];
  const items = parseJson(o.items, []);
  const ids = [...new Set(items.map((i) => String(i.shopify_product_id || '').replace(/\D/g, '')).filter(Boolean))];
  return {
    event_name: def.name(cfg),
    event_time: unix(at),
    event_id: `${kind}-${o.ref}`,
    action_source: def.action_source,
    user_data: userData(o),
    custom_data: {
      currency: 'DZD',
      value: Number(o.total) || 0,
      order_id: o.ref,
      ...(ids.length ? { content_ids: ids, content_type: 'product' } : {}),
      num_items: items.reduce((n, i) => n + (Number(i.qty) || 1), 0) || 1,
    },
    // الطلبية الأصلية (نفس order_id و event_id اللذين أرسلهما المتجر مع «Purchase»)
    original_event_data: { event_name: 'Purchase', event_time: unix(o.created_at), order_id: o.ref, ...(o.meta_event_id ? { event_id: o.meta_event_id } : {}) },
  };
}

/** أُرسل هذا الحدث فعلاً لهذه الطلبية (لا يُعاد عند التراجع عن الحالة ثم إعادتها) — الإرسال التجريبي لا يُحسب */
const alreadySent = (orderId, name) => Boolean(db.prepare("SELECT 1 FROM order_events WHERE order_id = ? AND type = 'meta' AND raw = ? AND note = 'ok'").get(orderId, name));
const logEvent = (orderId, name, note) => db.prepare("INSERT INTO order_events (order_id, type, raw, note, source, at) VALUES (?, 'meta', ?, ?, 'meta', ?)").run(orderId, name, note, nowIso());

/**
 * يُرسل الحدث في الخلفية إن كان مفعّلاً. طلبية يدوية دون صفحة هبوط لا تُرسل: لا نقرة إعلان تُنسب إليها.
 * النتيجة تُكتب في سجل الطلبية (ok / test / error: …).
 */
export function queueOrderEvent(o, kind) {
  const def = ORDER_EVENTS[kind];
  if (!def) return false;
  const cfg = projectConfig(o.project_id);
  if (!cfg[def.setting] || !cfg.meta_pixel_id || !cfg.meta_access_token) return false;
  if (o.source === 'manual' && !o.landing_url) return false;
  const name = def.name(cfg);
  if (alreadySent(o.id, name)) return false;
  const event = buildOrderEvent(o, kind, cfg);
  const testCode = String(cfg.meta_test_event_code || '').trim();
  enqueue(`capi:${o.project_id}`, `capi ${name} ${o.ref}`, async () => {
    try {
      const r = await meta.sendEvents(cfg, [event], { testCode });
      logEvent(o.id, name, testCode ? 'test' : r?.events_received === 1 ? 'ok' : `error: ${JSON.stringify(r).slice(0, 200)}`);
    } catch (e) {
      logEvent(o.id, name, `error: ${String(e.message).slice(0, 200)}`);
      throw e;
    }
  });
  return true;
}

/** تجربة الربط من الإعدادات: حدث «أُكّدت» وهمي يظهر في «اختبار الأحداث» فقط (يتطلب رمز الاختبار) */
export async function sendTestEvent(projectId, testCode) {
  const cfg = projectConfig(projectId);
  const code = String(testCode || cfg.meta_test_event_code || '').trim();
  if (!code) throw badRequest('capi_test_code_required');
  const fake = { ref: `TEST-${Date.now().toString(36).toUpperCase()}`, phone: '0550000000', customer_name: 'Test ERP', wilaya_code: 16, commune_fr: 'Alger Centre', total: 1, items: '[]', created_at: nowIso() };
  return meta.sendEvents(cfg, [buildOrderEvent(fake, 'confirmed', cfg)], { testCode: code });
}
