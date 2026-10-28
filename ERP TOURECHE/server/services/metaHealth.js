import { projectConfig, getSetting, setSetting } from '../lib/settings.js';
import { nowIso } from '../lib/util.js';
import * as meta from '../integrations/meta.js';
import { activeTestCode } from './capi.js';

/** حالة رمز Meta كما رآها آخر فحص (debug_token): يقرؤها المستشار والقرارات دون اتصال بـ Meta */
const fields = (life) => ({ type: life.type, expires_at: life.expires_at, data_access_expires_at: life.data_access_expires_at, ends_at: life.ends_at });

/** تحفظ نتيجة فحص جاهزة (من «اختبار» Meta في الإعدادات) فيزول التنبيه فور تجديد الرمز */
export function saveTokenState(projectId, token) {
  if (!token) return;
  // فحص لم يصل إلى حكم (شبكة، حد طلبات) لا يُنذر زوراً ولا يمحو تاريخاً محفوظاً: الحكم «غير صالح» لا يُحفظ إلا إن رفضت Meta الرمز نفسه
  if (token.valid === false && !token.auth) return;
  if (token.valid !== false && token.type == null && token.expires_at == null && token.ends_at == null) return;
  setSetting('meta_token_state', { checked_at: nowIso(), valid: token.valid === undefined ? null : token.valid, ...fields(token) }, projectId);
}

/**
 * فحص يومي للرمز. الرمز الميت (190) يُحفظ «غير صالح»؛ أي فشل آخر (شبكة، حد طلبات) لا يغيّر الحكم السابق ولا يُنذر زوراً.
 */
export async function refreshTokenState(projectId) {
  const cfg = projectConfig(projectId);
  if (!cfg.meta_access_token) {
    setSetting('meta_token_state', null, projectId);
    return null;
  }
  try {
    const info = (await meta.graph(cfg, 'debug_token', { params: { input_token: cfg.meta_access_token } }))?.data || null;
    saveTokenState(projectId, { valid: info ? Boolean(info.is_valid) : true, auth: true, ...meta.tokenLife(info) });
  } catch (e) {
    if (e.details?.code !== 190) return getSetting('meta_token_state', projectId);
    setSetting('meta_token_state', { checked_at: nowIso(), valid: false, type: null, expires_at: null, data_access_expires_at: null, ends_at: null }, projectId);
  }
  return getSetting('meta_token_state', projectId);
}

/** أيام الرمز المتبقية من التاريخ المحفوظ (تُحسب الآن لا وقت الفحص) */
export const daysLeft = (state, now = Date.now()) => (state?.ends_at ? Math.ceil((state.ends_at * 1000 - now) / 864e5) : null);

/**
 * تنبيهات الربط بـ Meta (قراءة محلية فقط): الرمز ميت أو ينتهي قريباً، ورمز «اختبار الأحداث» لا يزال يحوّل الأحداث عن الإنتاج.
 * يُنذَر قبل 14 يوماً من انتهاء الرمز لأن تجديده يحتاج حساب Meta نفسه (رسالة تحقق قد لا تصل).
 */
export function metaAlerts(projectId, cfg = projectConfig(projectId), now = Date.now()) {
  if (!meta.isConfigured(cfg)) return [];
  const out = [];
  const st = getSetting('meta_token_state', projectId);
  const days = daysLeft(st, now);
  if (st?.valid === false) out.push({ kind: 'token_invalid', severity: 'critical', action: 'open_meta_settings' });
  else if (days !== null && days <= 0) out.push({ kind: 'token_expired', severity: 'critical', params: { ends: new Date(st.ends_at * 1000).toISOString().slice(0, 10) }, action: 'open_meta_settings' });
  else if (days !== null && days <= 14)
    out.push({ kind: 'token_expiring', severity: days <= 3 ? 'critical' : days <= 7 ? 'high' : 'medium', params: { days, ends: new Date(st.ends_at * 1000).toISOString().slice(0, 10) }, action: 'open_meta_settings' });
  const tc = activeTestCode(projectId, cfg, now);
  if (tc.set && !tc.expired) out.push({ kind: 'test_code_active', severity: 'medium', params: { until: tc.until }, action: 'open_meta_settings' });
  else if (tc.expired) out.push({ kind: 'test_code_left', severity: 'low', action: 'open_meta_settings' });
  return out;
}
