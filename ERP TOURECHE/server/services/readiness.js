import { db } from '../db/index.js';
import { projectConfig, getSetting } from '../lib/settings.js';
import * as shopify from '../integrations/shopify.js';
import * as meta from '../integrations/meta.js';
import { CARRIERS } from '../integrations/carriers/index.js';
import { accountsHealth, fxSet, productLink } from './ads.js';
import { checkAdLink, LINK_BLOCKERS } from './links.js';
import { attributionHealth } from './pages.js';
import { trackingHealth } from './tracking.js';
import { backupStatus } from './backup.js';
import { activeTestCode } from './capi.js';
import { daysLeft } from './metaHealth.js';

/**
 * جاهزية الإطلاق: كل ما يجب أن يعمل قبل صرف أول دينار على الإعلانات، سطراً بسطر، بحالة واضحة لا بانطباع.
 *  ok = جاهز · warn = يعمل لكن فيه ما يستحق الانتباه · bad = يمنع أو يفسد القياس · unknown = لا معلومة بعد (لم يُفحص أو لا بيانات)
 * ما لا يراه الـ ERP أصلاً (رمز n8n، حالة التطبيق Live) يُعرض في الواجهة كتذكير يدوي.
 */
const SEVERITY = { bad: 3, warn: 2, unknown: 1, ok: 0 };
const worst = (states) => states.reduce((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), 'ok');
const item = (key, state, value, extra) => ({ key, state, ...(value !== undefined && value !== null ? { value } : {}), ...extra });

/** ما يُعرف دون اتصال بأي خدمة: الإعدادات والقاعدة المحلية */
export function localChecks(projectId, cfg = projectConfig(projectId), now = Date.now()) {
  const out = [];
  out.push(item('shopify', shopify.isConfigured(cfg) ? 'ok' : 'bad'));
  const live = db.prepare("SELECT COUNT(*) AS n FROM products WHERE project_id = ? AND handle IS NOT NULL AND handle != '' AND shopify_id IS NOT NULL AND COALESCE(shopify_status, 'ACTIVE') = 'ACTIVE' AND stage != 'archived'").get(projectId).n;
  out.push(item('products', live ? 'ok' : 'bad', live));
  out.push(item('meta_connected', meta.isConfigured(cfg) ? 'ok' : 'bad'));
  // الرمز: من آخر فحص محفوظ (المهمة اليومية أو زر «اختبار»)
  const st = getSetting('meta_token_state', projectId);
  const days = daysLeft(st, now);
  if (!meta.isConfigured(cfg)) out.push(item('meta_token', 'unknown'));
  else if (!st) out.push(item('meta_token', 'unknown'));
  else if (st.valid === false || (days !== null && days <= 0)) out.push(item('meta_token', 'bad'));
  else if (days !== null && days <= 14) out.push(item('meta_token', 'warn', days));
  else out.push(item('meta_token', 'ok', days));
  // أحداث الـ ERP تُرسل برمز البيكسل الدائم، لا برمز مستخدم ينتهي
  if (cfg.meta_capi_token) out.push(item('capi_token', 'ok'));
  else out.push(item('capi_token', !st ? 'unknown' : st.type === 'USER' || st.ends_at ? 'warn' : 'ok'));
  out.push(item('capi_events', cfg.meta_capi_confirmed || cfg.meta_capi_delivered ? 'ok' : 'warn'));
  const tc = activeTestCode(projectId, cfg, now);
  out.push(item('test_code', tc.set ? 'warn' : 'ok'));
  out.push(item('fx', fxSet() ? 'ok' : 'warn'));
  const visits = trackingHealth([projectId]);
  out.push(item('visits', !visits.last_visit_at ? 'unknown' : now - Date.parse(visits.last_visit_at) < 86400e3 ? 'ok' : 'warn'));
  const attr = attributionHealth([projectId]);
  out.push(item('attribution', attr.orders ? (attr.ok ? 'ok' : 'bad') : 'unknown', attr.orders ? `${attr.with_page}/${attr.orders}` : undefined));
  out.push(item('carriers', Object.values(CARRIERS).some((c) => c.isConfigured(cfg)) ? 'ok' : 'warn'));
  out.push(item('backup', backupStatus().offsite_ok ? 'ok' : 'warn'));
  return out;
}

/** صفحات المنتجات التي ستستقبل النقرات: تفتح، فيها البيكسل الصحيح ونموذج الطلب، ولا تحوّل ولا تبطؤ */
async function storePages(projectId, cfg) {
  const rows = db
    .prepare("SELECT id, title, handle, online_url FROM products WHERE project_id = ? AND handle IS NOT NULL AND handle != '' AND shopify_id IS NOT NULL AND COALESCE(shopify_status, 'ACTIVE') = 'ACTIVE' AND stage != 'archived' ORDER BY updated_at DESC LIMIT 3")
    .all(projectId);
  const results = await Promise.all(
    rows.map(async (p) => {
      const link = productLink(cfg, p);
      if (!link) return { title: p.title, state: 'unknown' };
      try {
        const r = await checkAdLink(projectId, link, { pixelId: cfg.meta_pixel_id });
        if (r.ok === null) return { title: p.title, state: 'unknown' };
        const codes = r.problems.map((x) => x.code);
        const bad = codes.some((c) => LINK_BLOCKERS.has(c) || ['pixel_missing', 'pixel_mismatch'].includes(c));
        const warn = codes.some((c) => ['form_missing', 'redirect', 'redirect_other_domain', 'canonical_mismatch', 'not_store_domain', 'slow'].includes(c));
        return { title: p.title, state: bad ? 'bad' : warn ? 'warn' : 'ok', problems: codes.filter((c) => c !== 'params_in_link') };
      } catch {
        return { title: p.title, state: 'unknown' };
      }
    }),
  );
  if (!results.length) return item('store_pages', 'unknown');
  const state = worst(results.map((r) => r.state));
  const first = results.find((r) => r.state === state);
  return item('store_pages', state, first && state !== 'ok' ? first.title : `${results.length}`, first?.problems?.length ? { params: { problems: first.problems } } : undefined);
}

/** ما يحتاج Meta: الحساب الإعلاني (نشط، وسيلة دفع، سقف) والبيكسل يستقبل أحداثاً */
async function metaAccounts(projectId, cfg) {
  if (!meta.isConfigured(cfg)) return [item('ad_account', 'unknown'), item('pixel_live', 'unknown')];
  let h;
  try {
    h = await accountsHealth(projectId);
  } catch {
    return [item('ad_account', 'unknown'), item('pixel_live', 'unknown')];
  }
  const accounts = h.accounts || [];
  const states = (key, bad) => accounts.map((a) => (a.error ? 'unknown' : (a.checks || []).find((c) => c.key === key)?.ok === false ? bad : (a.checks || []).find((c) => c.key === key)?.ok === true ? 'ok' : 'unknown'));
  const accountState = worst([...states('account_active', 'bad'), ...states('payment_method', 'bad'), ...states('spend_cap_ok', 'warn')]);
  const pixel = worst(states('pixel_events_48h', 'warn'));
  const first = accounts.find((a) => a.info);
  return [item('ad_account', accounts.length ? accountState : 'unknown', first?.info?.name), item('pixel_live', accounts.length ? pixel : 'unknown')];
}

const cacheMap = new Map();
/** القائمة كاملة (محلي + شبكة)، تُخزَّن دقيقتين حتى لا يُتعب فتح التبويب مرات متتالية الخدمات الخارجية */
export async function readiness(projectId, { fresh = false } = {}) {
  const hit = cacheMap.get(projectId);
  if (!fresh && hit && Date.now() - hit.at < 120e3) return hit.value;
  const cfg = projectConfig(projectId);
  const [pages, accounts] = await Promise.all([storePages(projectId, cfg), metaAccounts(projectId, cfg)]);
  const items = [...localChecks(projectId, cfg), ...accounts, pages];
  const counts = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const i of items) counts[i.state]++;
  const value = { at: new Date().toISOString(), items, counts, ready: counts.bad === 0 };
  cacheMap.set(projectId, { at: Date.now(), value });
  return value;
}
export const clearReadiness = () => cacheMap.clear();
