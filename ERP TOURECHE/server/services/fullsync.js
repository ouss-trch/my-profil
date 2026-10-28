import { db } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { nowIso } from '../lib/util.js';
import * as shopify from '../integrations/shopify.js';
import * as meta from '../integrations/meta.js';
import { CARRIERS } from '../integrations/carriers/index.js';
import { getProject } from './projects.js';
import { runJob, syncShopifyOrders, syncSheet } from './sync.js';
import { syncFromShopify } from './products.js';
import { syncTracking, refreshTariffs } from './shipments.js';
import { syncCampaigns, syncSpend, autoLink } from './ads.js';
import { syncPages } from './pages.js';
import { retryShopify as retryReturns } from './returns.js';

/**
 * المزامنة الكاملة بزر واحد (الشريط العلوي): كل ما يأتي من الخارج، بالترتيب الذي يجعل البيانات متسقة —
 * المنتجات قبل الطلبيات (لربط الطلبية بمنتجها)، والتتبع قبل إرسال المرتجعات إلى Shopify.
 * تعمل في الخلفية ويُقرأ تقدّمها خطوة بخطوة؛ ضغطة ثانية أثناء العمل لا تبدأ مزامنة أخرى.
 */
const carriersOn = (cfg) => Object.values(CARRIERS).some((c) => c.isConfigured(cfg));
const tariffsStale = (pid) => {
  const row = db.prepare("SELECT last_ok_at FROM job_state WHERE job = 'tariffs' AND project_id = ?").get(pid);
  return !row?.last_ok_at || Date.now() - Date.parse(row.last_ok_at) > 24 * 3600e3;
};

export const STEPS = [
  { key: 'products', when: (cfg) => shopify.isConfigured(cfg), run: (pid) => runJob('products', pid, 'منتجات Shopify', () => syncFromShopify(pid)) },
  { key: 'orders', when: (cfg) => shopify.isConfigured(cfg) && cfg.shopify_sync_orders, run: (pid) => syncShopifyOrders(pid) },
  { key: 'sheet', when: (cfg) => cfg.sheet_sync && cfg.sheet_id, run: (pid) => syncSheet(pid) },
  { key: 'pages', when: (cfg) => shopify.isConfigured(cfg), run: (pid) => runJob('pages', pid, 'صفحات المتجر', () => syncPages(pid)) },
  { key: 'tracking', when: carriersOn, run: (pid) => runJob('tracking', pid, 'تتبع الطرود', () => syncTracking(pid)) },
  // أسعار التوصيل تتغير نادراً وطلبها بطيء: مرة في اليوم تكفي
  { key: 'tariffs', when: (cfg, pid) => carriersOn(cfg) && tariffsStale(pid), run: (pid) => runJob('tariffs', pid, 'أسعار التوصيل', () => refreshTariffs(pid)) },
  { key: 'returns', when: (cfg) => shopify.isConfigured(cfg), run: (pid) => retryReturns(pid, { includeFailed: true }) },
  {
    key: 'campaigns',
    when: (cfg) => meta.isConfigured(cfg),
    run: (pid) =>
      runJob('ads_campaigns', pid, 'حملات Meta', async () => {
        const r = await syncCampaigns(pid);
        autoLink(pid);
        return r;
      }),
  },
  // 7 أيام: Meta يصحح أرقام الأيام الأخيرة (تأخر النسب)، والمزامنة يدوية فقد تمر أيام بين ضغطتين
  { key: 'spend', when: (cfg) => meta.isConfigured(cfg), run: (pid) => runJob('ads_spend', pid, 'Meta Ads', () => syncSpend(pid, 7)) },
];

let current = null;
export const status = () => current;

/** يبدأ المزامنة ويعيد حالتها فوراً (أو الحالة الجارية إن كانت تعمل) */
export function start(projectIds, { userId = null } = {}) {
  if (current?.running) return { ...current, already: true };
  const steps = [];
  for (const pid of projectIds) {
    const cfg = projectConfig(pid);
    for (const s of STEPS) if (s.when(cfg, pid)) steps.push({ project_id: pid, project: getProject(pid)?.name || String(pid), key: s.key, status: 'pending' });
  }
  current = { id: Date.now(), running: true, started_at: nowIso(), finished_at: null, user_id: userId, steps };
  const run = current;
  (async () => {
    for (const step of run.steps) {
      step.status = 'running';
      const t0 = Date.now();
      try {
        const out = await STEPS.find((s) => s.key === step.key).run(step.project_id);
        step.result = out ?? null;
        step.status = out?.skipped === 'running' ? 'skipped' : out?.errors?.length || out?.failed ? 'error' : 'ok';
        if (out?.errors?.length) step.error = out.errors.map((e) => `${e.carrier || ''} ${e.error}`.trim()).join(' · ');
        if (out?.failed) step.error = `returns_failed:${out.failed}`;
      } catch (e) {
        step.status = 'error';
        step.error = String(e.message || e).slice(0, 300);
      }
      step.ms = Date.now() - t0;
    }
    run.running = false;
    run.finished_at = nowIso();
  })();
  return current;
}

/** للاختبارات: انتظار انتهاء المزامنة الجارية */
export async function settle() {
  while (current?.running) await new Promise((r) => setTimeout(r, 10));
  return current;
}
