import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { requireRole, requireSensitive } from '../lib/auth.js';
import { SETTINGS, publicSettings, setSetting, projectConfig, getSetting } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { safeEqual } from '../lib/crypto.js';
import { HttpError, badRequest, v, normalizePhone } from '../lib/util.js';
import { WILAYAS } from '../lib/wilayas.js';
import { STATUSES, MANUAL } from '../lib/statuses.js';
import * as shopify from '../integrations/shopify.js';
import * as meta from '../integrations/meta.js';
import * as capi from '../services/capi.js';
import { saveTokenState } from '../services/metaHealth.js';
import * as n8n from '../integrations/n8n.js';
import * as ai from '../integrations/ai.js';
import { CARRIERS } from '../integrations/carriers/index.js';
import { listProjects, createProject, updateProject, deleteProject, getProject, projectScope } from '../services/projects.js';
import { createOrder } from '../services/orders.js';
import { jobStates } from '../services/sync.js';
import * as fullsync from '../services/fullsync.js';
import { recentFailures } from '../services/effects.js';
import { backup, backupStatus } from '../services/backup.js';
import { makeSnapshot, sendSnapshot } from '../services/snapshot.js';
import { updateStatus, requestUpdate, requestCheck } from '../services/updater.js';

export const coreRouter = Router();

// ——— بيانات مرجعية للواجهة ———
coreRouter.get('/meta', (_req, res) => {
  res.json({
    wilayas: WILAYAS,
    statuses: STATUSES,
    transitions: MANUAL,
    carriers: Object.fromEntries(Object.entries(CARRIERS).map(([k, c]) => [k, c.name])),
    ai_configured: ai.aiConfigured(),
    // سعر الصرف الفعلي (السوق الموازي) لتحويل إنفاق الإعلانات إلى الدينار
    fx: { usd: getSetting('fx_usd_dza') || 250, eur: getSetting('fx_eur_dza') || 270 },
  });
});

// ——— المشاريع ———
coreRouter.get('/projects', (_req, res) => {
  res.json(
    listProjects(true).map((p) => {
      const cfg = projectConfig(p.id);
      return {
        ...p,
        integrations: {
          shopify: shopify.isConfigured(cfg),
          meta: meta.isConfigured(cfg),
          carriers: Object.keys(CARRIERS).filter((k) => CARRIERS[k].isConfigured(cfg)),
          sheet: Boolean(cfg.sheet_sync && cfg.sheet_id),
        },
      };
    }),
  );
});

coreRouter.post('/projects', requireRole('admin'), requireSensitive, (req, res) => {
  const p = createProject({ name: v.str(req.body.name, { required: true, max: 80, name: 'name' }), slug: req.body.slug, domain: v.str(req.body.domain, { max: 120 }), color: v.str(req.body.color, { max: 9 }) });
  audit(req, 'project_created', { entity: 'project', entityId: p.id, details: { name: p.name } });
  res.json(p);
});

coreRouter.patch('/projects/:id', requireRole('admin', 'manager'), (req, res) => {
  const p = updateProject(Number(req.params.id), { name: v.str(req.body.name, { max: 80 }) ?? undefined, domain: req.body.domain, color: req.body.color, active: req.body.active });
  audit(req, 'project_updated', { entity: 'project', entityId: p.id });
  res.json(p);
});

coreRouter.delete('/projects/:id', requireRole('admin'), requireSensitive, (req, res) => {
  const p = getProject(Number(req.params.id));
  if (!p) throw new HttpError(404, 'project_not_found');
  deleteProject(p.id);
  audit(req, 'project_deleted', { entity: 'project', entityId: p.id, details: { name: p.name } });
  res.json({ ok: true });
});

// ——— الإعدادات (المفاتيح السرية لا تُعاد أبداً) ———
coreRouter.get('/settings/global', requireRole('admin'), (_req, res) => res.json(publicSettings('global')));
coreRouter.get('/settings/project/:id', requireRole('admin', 'manager'), (req, res) => {
  if (!getProject(Number(req.params.id))) throw new HttpError(404, 'project_not_found');
  // _auto: ما يُستعمل حين يُترك الحقل فارغاً (عنوان الـ ERP على الـ VPS)
  // _test_code: رمز «اختبار الأحداث» ينتهي تلقائياً بعد ساعات، فتُعرض مهلته في الإعدادات
  const { set, until, expired } = capi.activeTestCode(Number(req.params.id));
  res.json({ ...publicSettings('project', Number(req.params.id)), _auto: { split_base_url: config.publicUrl || null }, _test_code: { set, until, expired } });
});

function saveSettings(req, scopeName, projectId) {
  const changed = [];
  for (const [key, value] of Object.entries(req.body || {})) {
    const def = SETTINGS[key];
    if (!def || def.scope !== scopeName) throw badRequest(`unknown_setting:${key}`);
    if (def.secret && (value === undefined || (typeof value === 'object' && value !== null))) continue; // لم يُغيَّر
    try {
      setSetting(key, value, projectId);
    } catch (e) {
      throw badRequest(e.message);
    }
    changed.push(key);
    // رمز جديد: حكم الرمز القديم (منتهٍ أو قارب) لم يعد صحيحاً، ويُفحص الجديد عند «اختبار» أو في الفحص اليومي
    if (key === 'meta_access_token' && scopeName === 'project') setSetting('meta_token_state', null, projectId);
  }
  audit(req, 'settings_changed', { entity: scopeName, entityId: projectId || null, projectId, details: { keys: changed } });
  return changed;
}

coreRouter.put('/settings/global', requireRole('admin'), requireSensitive, (req, res) => {
  res.json({ changed: saveSettings(req, 'global') });
});

coreRouter.put('/settings/project/:id', requireRole('admin'), requireSensitive, (req, res) => {
  const id = Number(req.params.id);
  if (!getProject(id)) throw new HttpError(404, 'project_not_found');
  res.json({ changed: saveSettings(req, 'project', id) });
});

/** اختبار الربط مع كل خدمة */
coreRouter.post('/settings/test/:service', requireRole('admin', 'manager'), async (req, res) => {
  const projectId = Number(req.body.project_id || req.query.project_id);
  const cfg = projectId ? projectConfig(projectId) : null;
  const s = req.params.service;
  let result;
  try {
    if (s === 'shopify') result = await shopify.shopInfo(cfg);
    else if (s === 'meta') {
      // رمز «اختبار الأحداث» محفوظ: يُرسل حدث تجريبي يظهر في Events Manager فقط ويؤكد أن الرمز يرسل إلى البيكسل
      const test = capi.activeTestCode(projectId, cfg);
      result = await meta.connectionCheck(cfg, { capiTest: test.code && cfg.meta_pixel_id ? () => capi.sendTestEvent(projectId, test.code) : null });
      result.test_code = { set: test.set, until: test.until, expired: test.expired };
      saveTokenState(projectId, result.token);
    } else if (CARRIERS[s]) result = { ok: await CARRIERS[s].test(cfg) };
    else if (['events', 'products', 'report'].includes(s)) result = await n8n.send(s, 'test', { from: 'ERP TOURECHE' }, projectId || null);
    else if (s === 'sheets') {
      const rows = await n8n.sheetsRead(cfg.sheet_id, `${cfg.sheet_tab}!1:2`);
      result = { headers: rows[0] || [] };
    } else if (s === 'ai') result = { reply: await ai.text({ system: 'أجب بكلمة واحدة.', prompt: 'قل: جاهز', maxTokens: 1024, meter: { projectId: projectId || null, kind: 'test' } }) };
    else throw badRequest('unknown_service');
    res.json({ ok: true, result });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    res.json({ ok: false, error: e.message, kind: e.kind || null });
  }
});

// ——— سجل النشاط والنظام ———
coreRouter.get('/audit', requireRole('admin'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(
    db
      .prepare('SELECT a.*, u.display_name AS user_name, p.name AS project_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN projects p ON p.id = a.project_id ORDER BY a.id DESC LIMIT ?')
      .all(limit),
  );
});

coreRouter.get('/system/jobs', (_req, res) => res.json({ jobs: jobStates(), effects: recentFailures(), backup: backupStatus() }));

// المزامنة الكاملة (زر الشريط العلوي): تبدأ في الخلفية، والواجهة تقرأ تقدّمها
coreRouter.post('/system/sync', (req, res) => res.json(fullsync.start(projectScope(req).ids, { userId: req.user.id })));
coreRouter.get('/system/sync', (_req, res) => res.json(fullsync.status()));

coreRouter.post('/system/backup', requireRole('admin'), async (req, res) => {
  const out = await backup({ force: true });
  audit(req, 'backup_created', { details: { mirrored: Boolean(out.mirrored), mirror_error: out.mirrorError, drive: Boolean(out.drive), drive_error: out.driveError } });
  res.json({ file: out.file.split(/[\\/]/).pop(), mirrored: Boolean(out.mirrored), mirror_error: out.mirrorError, drive: Boolean(out.drive), drive_error: out.driveError, status: backupStatus() });
});

// تحديث الـ ERP من داخله (VPS): الطلب تنفّذه خدمة erp-updater على الخادم
coreRouter.get('/system/update', requireRole('admin'), (_req, res) => res.json(updateStatus()));
coreRouter.post('/system/update', requireRole('admin'), requireSensitive, (req, res) => {
  const out = requestUpdate();
  audit(req, 'update_requested', { details: { from: out.current.commit, behind: out.check?.behind ?? null } });
  res.json(out);
});
coreRouter.post('/system/update/check', requireRole('admin'), (_req, res) => res.json(requestCheck()));

coreRouter.get('/system/snapshot', requireRole('admin', 'manager'), async (_req, res) => res.json(await makeSnapshot()));
coreRouter.post('/system/snapshot', requireRole('admin', 'manager'), async (_req, res) => res.json(await sendSnapshot()));

/** بحث شامل (⌘K): طلبيات، زبائن، منتجات، مهام، جهات اتصال */
coreRouter.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ orders: [], products: [], tasks: [], contacts: [] });
  const like = `%${q}%`;
  const phone = normalizePhone(q);
  res.json({
    orders: db
      .prepare('SELECT id, ref, shopify_name, customer_name, phone, status, total FROM orders WHERE ref LIKE ? OR shopify_name LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR tracking LIKE ? ORDER BY id DESC LIMIT 8')
      .all(like, like, like, phone ? `%${phone}%` : like, like),
    products: db.prepare('SELECT id, title, price, stock FROM products WHERE title LIKE ? OR handle LIKE ? OR sku LIKE ? LIMIT 6').all(like, like, like),
    tasks: db.prepare("SELECT id, title, status, due_at FROM tasks WHERE title LIKE ? AND status != 'done' LIMIT 5").all(like),
    contacts: db.prepare('SELECT id, name, kind, phone FROM contacts WHERE name LIKE ? OR phone LIKE ? OR company LIKE ? LIMIT 5').all(like, like, like),
  });
});

// ——— استقبال الطلبيات من n8n أو أي نظام خارجي (بدون جلسة، بمفتاح) ———
export const hooksRouter = Router();
hooksRouter.post('/:slug/orders', (req, res) => {
  const key = getSetting('n8n_inbound_key');
  if (!key || !safeEqual(req.headers['x-erp-key'], key)) throw new HttpError(401, 'unauthorized');
  const p = db.prepare('SELECT * FROM projects WHERE slug = ?').get(req.params.slug);
  if (!p) throw new HttpError(404, 'project_not_found');
  const b = req.body || {};
  const r = createOrder(
    p.id,
    {
      ref: v.str(b.ref, { max: 40 }),
      customer_name: v.str(b.customer_name || b.name, { max: 120 }),
      phone: b.phone,
      wilaya: b.wilaya_code || b.wilaya,
      commune: v.str(b.commune, { max: 120 }),
      commune_fr: v.str(b.commune_fr || b.commune_latin, { max: 120 }),
      address: v.str(b.address, { max: 300 }),
      delivery_type: b.delivery_type === 'desk' || b.delivery === 'office' ? 'desk' : 'home',
      items: Array.isArray(b.items) ? b.items : [],
      shipping_fee: b.shipping_fee,
      discount: b.discount,
      total: b.total,
      utm_source: v.str(b.utm_source, { max: 60 }),
      utm_campaign: v.str(b.utm_campaign, { max: 120 }),
      utm_content: v.str(b.utm_content, { max: 120 }),
      landing_url: v.str(b.landing_url || b.landing_page, { max: 1000 }),
      meta_event_id: v.str(b.event_id, { max: 64 }),
      status: b.status === 'abandoned' ? 'abandoned' : 'new',
      notes: v.str(b.notes, { max: 1000 }),
    },
    { source: 'api' },
  );
  res.json({ ok: true, ...r });
});
