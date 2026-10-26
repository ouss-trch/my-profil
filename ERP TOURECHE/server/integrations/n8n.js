import { db } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { request, IntegrationError } from '../lib/http.js';
import { nowIso } from '../lib/util.js';

/**
 * التوافق مع سير العمل الحالية في n8n (leadsauto.cloud):
 *  - toureche-erp-events  ← test · order.status_changed · order.shipment_updated · stock.low · sync.failed · sync.recovered
 *  - toureche-erp-products ← test · product.published · social.posted
 *  - toureche-erp-report-… ← test · report.snapshot
 *  - toureche-erp-sheets  ← قراءة/كتابة جدولي SOU9NA و autoparts عبر المفتاح x-erp-key
 *  - toureche-erp-backup-… ← ملف النسخة الليلية مضغوطاً (?name=…db.gz) ← Google Drive، يرد { ok: true } (services/backup.js)
 * كل الطلبات بالشكل: { event, data, project, sent_at } — العقد في n8n تقرأ body.event و body.data
 */
const URL_KEY = { events: 'n8n_events_url', products: 'n8n_products_url', report: 'n8n_report_url' };

function projectInfo(projectId) {
  if (!projectId) return null;
  const p = db.prepare('SELECT id, slug, name FROM projects WHERE id = ?').get(projectId);
  return p || null;
}

export async function send(channel, event, data, projectId) {
  const url = getSetting(URL_KEY[channel]);
  if (!url) return { skipped: true };
  await request('n8n', url, {
    method: 'POST',
    body: { event, data, project: projectInfo(projectId), sent_at: nowIso() },
    timeoutMs: 15000,
    retries: 1,
  });
  return { ok: true };
}

/** إرسال بلا انتظار: لا يوقف العملية الأصلية إن كان n8n غير متاح */
export function emit(event, data, projectId) {
  send('events', event, data, projectId).catch((e) => console.warn('[n8n] event failed', event, e.message));
}

export function emitProduct(event, data, projectId) {
  return send('products', event, data, projectId);
}

// ——— جسر Google Sheets ———
const READ_SUFFIX = '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';

async function bridge(body) {
  const url = getSetting('n8n_sheets_url');
  const key = getSetting('n8n_sheets_key');
  if (!url || !key) throw new IntegrationError('sheets', 'config', 'bridge_not_configured');
  const { data } = await request('sheets', url, { method: 'POST', headers: { 'x-erp-key': key }, body, timeoutMs: 40000 });
  if (data?.error) {
    const kind = data.error === 'unauthorized' ? 'auth' : 'invalid';
    throw new IntegrationError('sheets', kind, data.error === 'unauthorized' ? 'bridge_unauthorized' : String(data.error?.message || data.error));
  }
  return data;
}

/** قراءة ورقة كاملة: يعيد مصفوفة صفوف (الصف الأول = العناوين) */
export async function sheetsRead(sheetId, range) {
  const data = await bridge({ method: 'GET', path: `${sheetId}/values/${encodeURIComponent(range)}${READ_SUFFIX}` });
  return Array.isArray(data?.values) ? data.values : [];
}

/** كتابة خلايا: [{ range: "customer!D5", values: [["confirmed"]] }] */
export async function sheetsWrite(sheetId, updates) {
  if (!updates.length) return null;
  const out = [];
  for (let i = 0; i < updates.length; i += 500) out.push(await bridge({ method: 'POST', path: `${sheetId}/values:batchUpdate`, body: { data: updates.slice(i, i + 500) } }));
  return out;
}
