import { db } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { dzDay, nowIso, round } from '../lib/util.js';
import { claudeUsd, geminiUsd, openaiImageUsd } from '../lib/apiPrices.js';
import { inList, listProjects } from './projects.js';

/**
 * دفتر كلفة الواجهات المدفوعة: كل طلب Claude أو صورة يُسجَّل باستهلاكه الفعلي (الرموز، الصور) وكلفته بالدولار،
 * ثم يدخل في المالية مصروفاً بالدينار بسعر الصرف في الإعدادات (نفس سعر الإعلانات).
 * التسجيل لا يوقف العملية الأصلية أبداً.
 */
const insert = db.prepare(
  `INSERT INTO api_usage (project_id, day, at, provider, model, kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, images, cost_usd)
   VALUES (@project_id, @day, @at, @provider, @model, @kind, @input, @output, @cache_read, @cache_write, @images, @cost)`,
);

function record(row) {
  try {
    insert.run({ project_id: row.projectId || null, day: dzDay(), at: nowIso(), provider: row.provider, model: row.model || null, kind: row.kind || 'other', input: row.input || 0, output: row.output || 0, cache_read: row.cacheRead || 0, cache_write: row.cacheWrite || 0, images: row.images || 0, cost: round(row.cost || 0, 6) });
  } catch (e) {
    console.warn('[api-cost] not recorded', e.message);
  }
}

/** meter = { projectId, kind } من مكان الطلب */
export function recordClaude(res, meter = {}) {
  const u = res?.usage;
  if (!u) return;
  record({ ...meter, provider: 'anthropic', model: res.model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, cost: claudeUsd(res.model, u) });
}

export function recordGemini(model, meta, images, meter = {}) {
  record({ ...meter, provider: 'gemini', model, input: meta?.promptTokenCount, output: meta?.candidatesTokenCount, images, cost: geminiUsd(model, meta, images) });
}

export function recordOpenAIImage(model, usage, images, meter = {}) {
  record({ ...meter, provider: 'openai', model, input: usage?.input_tokens, output: usage?.output_tokens, images, cost: openaiImageUsd(model, usage, images) });
}

/**
 * مصروف الواجهات في فترة: المجموع بالدولار والدينار + التفصيل حسب المزوّد والاستعمال والنموذج.
 * طلبات «كل المشاريع» (دون مشروع) تُحسب فقط حين تشمل الفترة كل المشاريع.
 */
export function apiCosts(projectIds, fromDay, toDay) {
  const all = listProjects().map((p) => p.id);
  const global = all.length > 0 && all.every((id) => projectIds.includes(id));
  const rows = db
    .prepare(
      `SELECT provider, kind, model, COUNT(*) AS calls, COALESCE(SUM(images), 0) AS images, COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cost_usd), 0) AS usd
       FROM api_usage WHERE (project_id IN (${inList(projectIds)})${global ? ' OR project_id IS NULL' : ''}) AND day >= ? AND day <= ?
       GROUP BY provider, kind, model ORDER BY usd DESC`,
    )
    .all(...projectIds, fromDay, toDay);
  const fx = getSetting('fx_usd_dza') || 250;
  const usd = rows.reduce((s, r) => s + r.usd, 0);
  return { usd: round(usd, 4), da: round(usd * fx), fx, rows: rows.map((r) => ({ ...r, usd: round(r.usd, 4), da: round(r.usd * fx) })) };
}
