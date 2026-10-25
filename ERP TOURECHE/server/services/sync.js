import { db } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { nowIso, num, normalizePhone, addDays, dzDay } from '../lib/util.js';
import { parseWilaya } from '../lib/wilayas.js';
import * as shopify from '../integrations/shopify.js';
import * as n8n from '../integrations/n8n.js';
import { upsertFromShopify, createOrder, changeStatus, SHEET_STATUS } from './orders.js';
import { getProject } from './projects.js';

const running = new Set();

/**
 * تشغيل مهمة مزامنة مع تتبع حالتها وتنبيهات ذكية:
 * - لا تنبيه لفشل عابر؛ تنبيه واحد بعد 3 إخفاقات متتالية، ثم «عادت المزامنة» عند النجاح.
 * - انقطاع الإنترنت يُبلَّغ مرة واحدة فقط لكل انقطاع.
 */
export async function runJob(job, projectId, label, fn) {
  const key = `${job}:${projectId}`;
  if (running.has(key)) return { skipped: 'running' };
  running.add(key);
  const state = db.prepare('SELECT * FROM job_state WHERE job = ? AND project_id = ?').get(job, projectId) || { fail_count: 0, alerted: 0 };
  try {
    const result = await fn(state);
    db.prepare(
      `INSERT INTO job_state (job, project_id, last_run_at, last_ok_at, last_error, fail_count, alerted, cursor) VALUES (?, ?, ?, ?, NULL, 0, 0, ?)
       ON CONFLICT(job, project_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_ok_at = excluded.last_ok_at, last_error = NULL, fail_count = 0, alerted = 0,
         cursor = COALESCE(excluded.cursor, job_state.cursor)`,
    ).run(job, projectId, nowIso(), nowIso(), result?.cursor ?? null);
    if (state.alerted) n8n.emit('sync.recovered', { name: label }, projectId);
    const net = db.prepare("SELECT alerted FROM job_state WHERE job = 'network' AND project_id = 0").get();
    if (net?.alerted) {
      db.prepare("UPDATE job_state SET alerted = 0, fail_count = 0 WHERE job = 'network' AND project_id = 0").run();
      n8n.emit('sync.recovered', { name: 'network' }, null);
    }
    return result;
  } catch (e) {
    const fails = (state.fail_count || 0) + 1;
    let alerted = state.alerted || 0;
    if (e.kind === 'network') {
      const net = db.prepare("SELECT alerted FROM job_state WHERE job = 'network' AND project_id = 0").get();
      if (!net?.alerted) {
        db.prepare(
          `INSERT INTO job_state (job, project_id, last_run_at, alerted, fail_count) VALUES ('network', 0, ?, 1, 1)
           ON CONFLICT(job, project_id) DO UPDATE SET alerted = 1, last_run_at = excluded.last_run_at`,
        ).run(nowIso());
        n8n.emit('sync.failed', { kind: 'network', name: label, error: 'network_unreachable' }, projectId);
      }
    } else if (fails >= 3 && !alerted) {
      alerted = 1;
      n8n.emit('sync.failed', { kind: e.kind || 'error', name: `${label} — ${getProject(projectId)?.name || ''}`, error: e.message }, projectId);
    }
    db.prepare(
      `INSERT INTO job_state (job, project_id, last_run_at, last_error, fail_count, alerted) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(job, project_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_error = excluded.last_error, fail_count = excluded.fail_count, alerted = excluded.alerted`,
    ).run(job, projectId, nowIso(), String(e.message).slice(0, 500), fails, alerted);
    throw e;
  } finally {
    running.delete(key);
  }
}

export const jobStates = () => db.prepare('SELECT * FROM job_state WHERE job NOT LIKE ? ORDER BY job, project_id').all('stock.low:%');

/** سحب طلبيات Shopify المعدلة منذ آخر مزامنة (يشمل طلبيات سير COD في n8n) */
export async function syncShopifyOrders(projectId) {
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg) || !cfg.shopify_sync_orders) return { skipped: true };
  return runJob('shopify_orders', projectId, 'Shopify', async (state) => {
    const nodes = await shopify.ordersUpdatedSince(cfg, state.cursor || null);
    let created = 0;
    let cursor = state.cursor || null;
    for (const node of nodes) {
      const res = upsertFromShopify(projectId, shopify.parseOrder(node));
      if (res.created) created++;
      if (!cursor || node.updatedAt > cursor) cursor = node.updatedAt;
    }
    return { fetched: nodes.length, created, cursor };
  });
}

const FROM_SHEET = { created: 'new', abandoned: 'abandoned', confirmed: 'confirmed', shipped: 'shipped', delivered: 'delivered', returned: 'returned', cancelled: 'cancelled', 'NOT CREATED': 'new' };

/** استيراد طلبيات جدول Google (SOU9NA Orders) عبر جسر n8n: الطلبيات المتروكة وغير المنشأة في Shopify */
export async function syncSheet(projectId) {
  const cfg = projectConfig(projectId);
  if (!cfg.sheet_sync || !cfg.sheet_id) return { skipped: true };
  return runJob('sheet', projectId, 'Google Sheets', async () => {
    const rows = await n8n.sheetsRead(cfg.sheet_id, cfg.sheet_tab);
    if (!rows.length) return { rows: 0 };
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    for (const req of ['ref', 'status', 'phone']) if (col(req) < 0) throw Object.assign(new Error(`mapping_missing ${req}`), { kind: 'invalid' });
    const get = (row, name) => (col(name) >= 0 ? row[col(name)] : undefined);
    const minDate = new Date(Date.now() - 90 * 86400e3).toISOString();
    let created = 0;
    let linked = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const ref = String(get(row, 'ref') || '').trim();
      if (!ref) continue;
      const sheetRow = i + 1;
      const existing = db.prepare('SELECT id, sheet_row FROM orders WHERE project_id = ? AND ref = ?').get(projectId, ref);
      if (existing) {
        if (existing.sheet_row !== sheetRow) {
          db.prepare('UPDATE orders SET sheet_row = ? WHERE id = ?').run(sheetRow, existing.id);
          linked++;
        }
        continue;
      }
      const date = String(get(row, 'date') || '');
      const createdAt = /^\d{4}-\d{2}-\d{2}T/.test(date) ? new Date(date).toISOString() : null;
      if (createdAt && createdAt < minDate) continue;
      const sheetStatus = String(get(row, 'status') || '').trim();
      const target = FROM_SHEET[sheetStatus] || 'new';
      const qty = num(get(row, 'qty'), 1) || 1;
      const subtotal = num(get(row, 'subtotal'));
      const res = createOrder(
        projectId,
        {
          ref,
          shopify_name: get(row, 'shopify_order') || null,
          customer_name: get(row, 'name'),
          phone: normalizePhone(get(row, 'phone')),
          wilaya: get(row, 'wilaya'),
          commune: get(row, 'commune'),
          address: get(row, 'address'),
          delivery_type: /office|desk/i.test(String(get(row, 'delivery') || '')) ? 'desk' : 'home',
          items: get(row, 'product') ? [{ title: String(get(row, 'product')), variant: String(get(row, 'variant') || ''), qty, price: subtotal ? subtotal / qty : 0 }] : [],
          subtotal,
          discount: num(get(row, 'discount')),
          shipping_fee: num(get(row, 'shipping')),
          total: num(get(row, 'total')),
          notes: get(row, 'notes') || null,
          utm_source: get(row, 'utm_source') || null,
          utm_campaign: get(row, 'utm_campaign') || null,
          utm_content: get(row, 'utm_content') || null,
          landing_url: get(row, 'landing_page') || get(row, 'landing_url') || null,
          tags: sheetStatus === 'NOT CREATED' ? ['not-created-in-shopify'] : [],
          status: target === 'abandoned' ? 'abandoned' : 'new',
          sheet_row: sheetRow,
          created_at: createdAt || undefined,
        },
        { source: 'sheet' },
      );
      if (res.created) {
        created++;
        if (!['new', 'abandoned'].includes(target)) changeStatus(res.id, target, { source: 'sheet', force: true, at: createdAt || undefined });
      }
    }
    return { rows: rows.length - 1, created, linked };
  });
}

// ——— لقطة التقرير الصباحي (نفس الشكل الذي يقرؤه سير «ERP Toureche · التقرير الصباحي») ———
export async function buildSnapshot(projectIds, { businessesFor, adsFor, hubFor }) {
  const today = dzDay();
  const yesterday = addDays(today, -1);
  const businesses = projectIds.map((id) => businessesFor(id, yesterday));
  return {
    generated_at: new Date(Date.now() + 3600e3).toISOString().replace('Z', '+01:00'),
    day: yesterday,
    businesses,
    ads: adsFor(projectIds, yesterday),
    low_stock: db
      .prepare(`SELECT title AS name, stock FROM products WHERE project_id IN (${projectIds.map(() => '?').join(',') || 'NULL'}) AND stage != 'archived' AND stock IS NOT NULL AND stock <= low_stock ORDER BY stock LIMIT 10`)
      .all(...projectIds),
    ads_hub: hubFor(projectIds),
  };
}

export { SHEET_STATUS, parseWilaya };
