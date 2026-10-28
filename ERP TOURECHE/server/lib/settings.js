import { db, parseJson } from '../db/index.js';
import { encrypt, decrypt } from './crypto.js';
import { nowIso } from './util.js';

// نماذج Claude المتاحة في القائمة (أسماء API الدقيقة — الاسم المكتوب خطأً يعطي 404)
export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
// «Claude Sonnet 5.5» أو «claude-sonnet 5.5» ← claude-sonnet-5-5
const modelId = (v) => String(v).trim().toLowerCase().replace(/[\s._]+/g, '-');
// النسخ واللصق يجلب مسافات وحروفاً خفية (اتجاه النص، عرض صفري): «1zDf…H_wQ » يرفضه جسر n8n بـ sheet_not_allowed
const INVISIBLE = '\\s\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF';
const EDGES = new RegExp(`^[${INVISIBLE}]+|[${INVISIBLE}]+$`, 'g');
const ANYWHERE = new RegExp(`[${INVISIBLE}]+`, 'g');
const clean = (v) => String(v).replace(EDGES, '');
/** معرّف Google Sheet: يُقبل الرابط كاملاً (…/spreadsheets/d/<المعرّف>/edit) أو المعرّف وحده */
export const sheetId = (v) => {
  const s = String(v ?? '').replace(ANYWHERE, '');
  return /\/spreadsheets\/d\/([\w-]+)/.exec(s)?.[1] || s;
};

/**
 * تعريف كل الإعدادات: النطاق (global أو project)، هل هي سرّية (تُشفَّر ولا تُعاد للواجهة)، والقيمة الافتراضية.
 * المفاتيح السرية لا تُرجعها الواجهة أبداً — فقط «مضبوط/غير مضبوط» وآخر 4 أحرف.
 */
export const SETTINGS = {
  // ——— عام ———
  n8n_events_url: { scope: 'global', type: 'url', def: '' },
  n8n_products_url: { scope: 'global', type: 'url', def: '' },
  n8n_report_url: { scope: 'global', type: 'url', def: '' },
  // نسخة احتياطية خارج الخادم: n8n يرفعها إلى Google Drive (رابط فيه رمز سري: لا يُنشر)
  n8n_backup_url: { scope: 'global', type: 'url', def: '' },
  n8n_sheets_url: { scope: 'global', type: 'url', def: '' },
  n8n_sheets_key: { scope: 'global', type: 'string', secret: true },
  n8n_image_url: { scope: 'global', type: 'url', def: '' },
  n8n_inbound_key: { scope: 'global', type: 'string', secret: true },
  anthropic_api_key: { scope: 'global', type: 'string', secret: true },
  ai_model: { scope: 'global', type: 'enum', values: AI_MODELS, normalize: modelId, def: 'claude-opus-5-5' },
  ai_effort: { scope: 'global', type: 'enum', values: ['low', 'medium', 'high', 'xhigh', 'max'], def: 'medium' },
  image_provider: { scope: 'global', type: 'enum', values: ['none', 'n8n', 'openai', 'gemini'], def: 'none' },
  openai_api_key: { scope: 'global', type: 'string', secret: true },
  openai_image_model: { scope: 'global', type: 'string', def: 'gpt-image-1' },
  gemini_api_key: { scope: 'global', type: 'string', secret: true },
  gemini_image_model: { scope: 'global', type: 'string', def: 'gemini-nano-banana-2.1' }, // gemini-2.5-flash-image يتوقف في 2027-03-15
  fx_usd_dza: { scope: 'global', type: 'number', def: 250 },
  fx_eur_dza: { scope: 'global', type: 'number', def: 270 },
  carrier_weights: { scope: 'global', type: 'json', def: { success: 0.45, speed: 0.25, contact: 0.15, cost: 0.15 } },
  carrier_window_days: { scope: 'global', type: 'number', def: 120 },
  report_hour: { scope: 'global', type: 'number', def: 7 },
  // المزامنة التلقائية (كل 5 دقائق…): متوقفة افتراضياً — المزامنة بزر الشريط العلوي
  auto_sync: { scope: 'global', type: 'bool', def: false },
  // ——— لكل مشروع ———
  brand_name: { scope: 'project', type: 'string', def: '' },
  store_domain: { scope: 'project', type: 'string', def: '' },
  shopify_shop: { scope: 'project', type: 'string', def: '' },
  shopify_api_version: { scope: 'project', type: 'string', def: '2026-07' },
  shopify_access_token: { scope: 'project', type: 'string', secret: true },
  shopify_client_id: { scope: 'project', type: 'string', def: '' },
  shopify_client_secret: { scope: 'project', type: 'string', secret: true },
  shopify_sync_orders: { scope: 'project', type: 'bool', def: true },
  shopify_tag_orders: { scope: 'project', type: 'bool', def: true },
  meta_access_token: { scope: 'project', type: 'string', secret: true },
  meta_ad_account_ids: { scope: 'project', type: 'json', def: [] },
  meta_business_id: { scope: 'project', type: 'string', def: '' },
  split_base_url: { scope: 'project', type: 'url', def: '' },
  ads_launch_defaults: { scope: 'project', type: 'json', def: {} },
  meta_page_id: { scope: 'project', type: 'string', def: '' },
  meta_page_token: { scope: 'project', type: 'string', secret: true },
  meta_ig_user_id: { scope: 'project', type: 'string', def: '' },
  meta_pixel_id: { scope: 'project', type: 'string', def: '' },
  // رمز «API التحويلات» من Events Manager (خاص بالبيكسل ولا ينتهي): يُرسل به الـ ERP أحداثه، فلا يتأثر بانتهاء رمز المستخدم. فارغاً: يُستعمل الرمز العام
  meta_capi_token: { scope: 'project', type: 'string', secret: true },
  meta_graph_version: { scope: 'project', type: 'string', def: 'v25.0' },
  meta_capi_confirmed: { scope: 'project', type: 'bool', def: false },
  meta_capi_confirmed_event: { scope: 'project', type: 'string', def: 'OrderConfirmed' },
  meta_capi_delivered: { scope: 'project', type: 'bool', def: false },
  meta_capi_event: { scope: 'project', type: 'string', def: 'OrderDelivered' },
  meta_test_event_code: { scope: 'project', type: 'string', def: '' },
  // حالة الرمز من آخر فحص (تكتبها المهمة اليومية و«اختبار» Meta، لا المستخدم): تغذّي تنبيه الانتهاء
  meta_token_state: { scope: 'project', type: 'json', def: null },
  default_carrier: { scope: 'project', type: 'enum', values: ['', 'yalidine', 'zr', 'noest'], def: '' },
  yalidine_api_id: { scope: 'project', type: 'string', def: '' },
  yalidine_api_token: { scope: 'project', type: 'string', secret: true },
  yalidine_from_wilaya: { scope: 'project', type: 'number', def: 16 },
  zr_token: { scope: 'project', type: 'string', secret: true },
  zr_key: { scope: 'project', type: 'string', secret: true },
  noest_api_token: { scope: 'project', type: 'string', secret: true },
  noest_user_guid: { scope: 'project', type: 'string', secret: true },
  sheet_id: { scope: 'project', type: 'string', def: '', normalize: sheetId },
  sheet_tab: { scope: 'project', type: 'string', def: 'customer' },
  sheet_sync: { scope: 'project', type: 'bool', def: false },
  test_kill_spend_da: { scope: 'project', type: 'number', def: 3000 },
  test_target_cpd_da: { scope: 'project', type: 'number', def: 900 },
  low_stock_default: { scope: 'project', type: 'number', def: 5 },
};

const scopeOf = (key, projectId) => {
  const def = SETTINGS[key];
  if (!def) throw new Error(`unknown_setting:${key}`);
  if (def.scope === 'global') return 'global';
  if (!projectId) throw new Error(`project_required:${key}`);
  return `project:${projectId}`;
};

const getStmt = db.prepare('SELECT value, is_secret FROM settings WHERE scope = ? AND key = ?');

/** متى حُفظ هذا الإعداد آخر مرة (ISO) أو null إن لم يُحفظ */
export const settingUpdatedAt = (key, projectId) => db.prepare('SELECT updated_at FROM settings WHERE scope = ? AND key = ?').get(scopeOf(key, projectId), key)?.updated_at || null;

/** قيمة داخلية (تُفك السرية) — لا تُرسل للواجهة */
export function getSetting(key, projectId) {
  const def = SETTINGS[key];
  const row = getStmt.get(scopeOf(key, projectId), key);
  if (!row || row.value === null) return def.def ?? (def.secret ? '' : null);
  if (row.is_secret) {
    try {
      return decrypt(row.value);
    } catch {
      return '';
    }
  }
  return coerce(def, parseJson(row.value, row.value));
}

function coerce(def, val) {
  if (val === null || val === undefined) return def.def ?? null;
  switch (def.type) {
    case 'number':
      return Number.isFinite(Number(val)) ? Number(val) : def.def;
    case 'bool':
      return val === true || val === 'true' || val === 1 || val === '1';
    case 'enum': {
      // قيمة قديمة خارج القائمة (مثل نموذج كُتب يدوياً) لا تكسر شيئاً: تُصحَّح أو تعود للافتراضي
      if (def.values.includes(val)) return val;
      const fixed = def.normalize ? def.normalize(val) : val;
      return def.values.includes(fixed) ? fixed : def.def;
    }
    case 'string':
    case 'url':
      // قيم حُفظت قبل التنظيف (بمسافة في آخرها) تُصحَّح عند القراءة دون إعادة إدخالها
      return typeof val === 'string' ? (def.normalize ? def.normalize(val) : clean(val)) : val;
    default:
      return val;
  }
}

export function setSetting(key, value, projectId) {
  const def = SETTINGS[key];
  const scope = scopeOf(key, projectId);
  if (def.secret) {
    if (value === null || value === '') {
      db.prepare('DELETE FROM settings WHERE scope = ? AND key = ?').run(scope, key);
      return;
    }
    db.prepare(
      `INSERT INTO settings (scope, key, value, is_secret, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, is_secret = 1, updated_at = excluded.updated_at`,
    ).run(scope, key, encrypt(String(value).trim()), nowIso());
    return;
  }
  let val = value;
  if ((def.type === 'string' || def.type === 'url') && typeof val === 'string') val = def.normalize ? def.normalize(val) : clean(val);
  if (def.type === 'number') val = value === '' || value === null ? null : Number(value);
  if (def.type === 'bool') val = value === true || value === 'true' || value === 1 || value === '1';
  if (def.type === 'enum' && val !== null && def.normalize) val = def.normalize(val);
  if (def.type === 'enum' && val !== null && !def.values.includes(val)) throw new Error(`invalid_value:${key}`);
  if (def.type === 'url' && val && !/^https?:\/\/[^\s]+$/i.test(String(val))) throw new Error(`invalid_url:${key}`);
  db.prepare(
    `INSERT INTO settings (scope, key, value, is_secret, updated_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, is_secret = 0, updated_at = excluded.updated_at`,
  ).run(scope, key, JSON.stringify(val), nowIso());
}

/** للواجهة: القيم العادية كما هي، والسرية كـ {set, hint} فقط */
export function publicSettings(scopeName, projectId) {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (def.scope !== scopeName) continue;
    if (def.secret) {
      const v = getSetting(key, projectId);
      out[key] = { secret: true, set: Boolean(v), hint: v ? '••••' + String(v).slice(-4) : '' };
    } else out[key] = getSetting(key, projectId);
  }
  return out;
}

/** كل إعدادات مشروع (مع الأسرار) للاستعمال الداخلي في التكاملات */
export function projectConfig(projectId) {
  const out = { projectId };
  for (const [key, def] of Object.entries(SETTINGS)) out[key] = getSetting(key, def.scope === 'project' ? projectId : undefined);
  return out;
}

// كلمة مرور العمليات الحساسة (منفصلة عن كلمة مرور الدخول) — تُخزن كتجزئة bcrypt فقط
export const getSensitiveHash = () => {
  const row = getStmt.get('security', 'sensitive_hash');
  return row ? parseJson(row.value, null) : null;
};
export const setSensitiveHash = (hash) =>
  db.prepare(
    `INSERT INTO settings (scope, key, value, is_secret, updated_at) VALUES ('security', 'sensitive_hash', ?, 0, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(hash), nowIso());
