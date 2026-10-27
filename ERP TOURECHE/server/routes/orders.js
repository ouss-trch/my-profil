import { Router } from 'express';
import { requireRole, requireSensitive } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, v } from '../lib/util.js';
import { STATUSES } from '../lib/statuses.js';
import { projectConfig } from '../lib/settings.js';
import { CARRIERS, carrier as getCarrier } from '../integrations/carriers/index.js';
import { projectScope, getProject } from '../services/projects.js';
import * as orders from '../services/orders.js';
import * as shipments from '../services/shipments.js';
import * as analytics from '../services/analytics.js';
import * as returns from '../services/returns.js';
import { db } from '../db/index.js';
import { runJob } from '../services/sync.js';

export const ordersRouter = Router();

const listArgs = (req) => ({
  status: req.query.status || undefined,
  statuses: req.query.statuses ? String(req.query.statuses).split(',').filter((s) => STATUSES[s]) : undefined,
  q: req.query.q,
  wilaya: req.query.wilaya,
  carrier: req.query.carrier,
  from: req.query.from,
  to: req.query.to,
  dateField: req.query.date_field,
  limit: req.query.limit,
  offset: req.query.offset,
  sort: req.query.sort,
  callbackDue: req.query.callback_due === '1',
});

ordersRouter.get('/', (req, res) => {
  const scope = projectScope(req);
  res.json(orders.listOrders({ projectIds: scope.ids, ...listArgs(req) }));
});

ordersRouter.get('/counts', (req, res) => res.json(orders.statusCounts(projectScope(req).ids)));

/** تصدير CSV (لشركة التوصيل أو المحاسبة) */
ordersRouter.get('/export.csv', (req, res) => {
  const scope = projectScope(req);
  const { rows } = orders.listOrders({ projectIds: scope.ids, ...listArgs(req), limit: 500 });
  const cols = ['ref', 'shopify_name', 'created_at', 'status', 'customer_name', 'phone', 'wilaya_code', 'commune', 'address', 'delivery_type', 'total', 'carrier', 'tracking'];
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  // الصفحة: زاوية صفحة الهبوط، أو «product» لصفحة المنتج؛ والاختبار «slug.B» إن جاءت من رابط اختبار
  const page = (o) => (o.page ? (o.page.kind === 'product' ? 'product' : o.page.label) : '');
  const test = (o) => (o.page?.test ? `${o.page.test.slug}.${o.page.test.label}` : '');
  const lines = [
    [...cols, 'items', 'landing_page', 'ab_test'].join(','),
    ...rows.map((o) => [...cols.map((c) => esc(o[c])), esc(o.items.map((i) => `${i.title} ${i.variant || ''} x${i.qty}`).join(' | ')), esc(page(o)), esc(test(o))].join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send('﻿' + lines.join('\n'));
});

ordersRouter.get('/:id', (req, res) => res.json(orders.getOrder(Number(req.params.id))));

ordersRouter.post('/', (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  const r = orders.createOrder(scope.id, req.body, { source: 'manual', userId: req.user.id });
  res.json(orders.getOrder(r.id));
});

ordersRouter.patch('/:id', (req, res, next) => {
  const id = Number(req.params.id);
  // تعديل المبالغ بعد الإنشاء عملية حساسة
  const money = ['shipping_fee', 'discount', 'items'].some((k) => req.body[k] !== undefined);
  const run = () => {
    const o = orders.updateOrder(id, req.body, { userId: req.user.id });
    if (money) audit(req, 'order_amounts_changed', { entity: 'order', entityId: id, projectId: o.project_id, details: { total: o.total } });
    res.json(o);
  };
  if (money) return requireSensitive(req, res, (err) => (err ? next(err) : run()));
  run();
});

ordersRouter.post('/:id/status', (req, res) => {
  const to = v.oneOf(req.body.status, Object.keys(STATUSES), { required: true, name: 'status' });
  res.json(
    orders.changeStatus(Number(req.params.id), to, {
      userId: req.user.id,
      note: v.str(req.body.note, { max: 1000 }),
      callbackAt: req.body.callback_at || null,
      cancelReason: v.str(req.body.cancel_reason, { max: 200 }),
    }),
  );
});

ordersRouter.post('/bulk/status', (req, res) => {
  const to = v.oneOf(req.body.status, Object.keys(STATUSES), { required: true, name: 'status' });
  const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 300);
  const results = ids.map((id) => {
    try {
      orders.changeStatus(id, to, { userId: req.user.id, note: 'bulk' });
      return { id, ok: true };
    } catch (e) {
      return { id, ok: false, error: e.code || e.message };
    }
  });
  res.json({ results });
});

ordersRouter.post('/:id/note', (req, res) => res.json(orders.addNote(Number(req.params.id), v.str(req.body.note, { required: true, max: 2000, name: 'note' }), req.user.id)));

ordersRouter.delete('/:id', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const o = orders.getOrder(Number(req.params.id));
  orders.deleteOrder(o.id);
  audit(req, 'order_deleted', { entity: 'order', entityId: o.id, projectId: o.project_id, details: { ref: o.ref, customer: o.customer_name, total: o.total } });
  res.json({ ok: true });
});

// ——— الشحن ———
ordersRouter.post('/:id/ship', async (req, res) => {
  const o = await shipments.sendToCarrier(
    Number(req.params.id),
    {
      carrier: req.body.carrier,
      commune: v.str(req.body.commune, { max: 120 }),
      stopdesk_id: v.str(req.body.stopdesk_id, { max: 40 }),
      delivery_type: req.body.delivery_type,
      note: v.str(req.body.note, { max: 250 }),
      weight: v.num(req.body.weight, { min: 0, max: 30 }),
    },
    { userId: req.user.id },
  );
  audit(req, 'order_shipped', { entity: 'order', entityId: o.id, projectId: o.project_id, details: { carrier: o.carrier, tracking: o.tracking } });
  res.json(o);
});

ordersRouter.post('/bulk/ship', async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 100);
  const results = [];
  for (const id of ids) {
    try {
      const o = await shipments.sendToCarrier(id, { carrier: req.body.carrier }, { userId: req.user.id });
      results.push({ id, ok: true, tracking: o.tracking });
    } catch (e) {
      results.push({ id, ok: false, error: e.code || e.message, details: e.details?.suggestions ? { suggestions: e.details.suggestions } : undefined });
    }
  }
  res.json({ results });
});

ordersRouter.post('/:id/tracking', (req, res) =>
  res.json(shipments.attachTracking(Number(req.params.id), { carrier: req.body.carrier, tracking: v.str(req.body.tracking, { required: true, max: 60, name: 'tracking' }) }, { userId: req.user.id })),
);

ordersRouter.post('/:id/sync-tracking', async (req, res) => {
  const o = orders.getOrder(Number(req.params.id));
  await shipments.syncTracking(o.project_id, { orderIds: [o.id] });
  res.json(orders.getOrder(o.id));
});

/** بوليصة الشحن: رابط مباشر (Yalidine) أو ملف PDF عبر الخادم (NOEST يتطلب المفتاح) */
ordersRouter.get('/:id/label', async (req, res) => {
  const o = orders.getOrder(Number(req.params.id));
  if (o.label_url) return res.redirect(o.label_url);
  if (o.carrier === 'noest' && o.tracking) {
    const r = await CARRIERS.noest.label(projectConfig(o.project_id), o.tracking);
    if (!r.ok) throw new HttpError(502, 'label_unavailable');
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${o.tracking}.pdf"`);
    return res.send(Buffer.from(await r.arrayBuffer()));
  }
  throw new HttpError(404, 'label_unavailable');
});

// ——— الزبائن ———
export const customersRouter = Router();

customersRouter.get('/', (req, res) => res.json(orders.listCustomers({ projectIds: projectScope(req).ids, q: req.query.q, risk: req.query.risk, sort: req.query.sort, limit: req.query.limit, offset: req.query.offset })));

customersRouter.get('/:phone', (req, res) => {
  const scope = projectScope(req);
  const summary = orders.customerSummary(req.params.phone);
  if (!summary) throw new HttpError(404, 'customer_not_found');
  res.json({ ...summary, orders: orders.listOrders({ projectIds: scope.ids, q: req.params.phone, statuses: Object.keys(STATUSES), limit: 100 }).rows });
});

customersRouter.put('/:phone/flag', (req, res) => {
  const r = orders.setCustomerFlag(req.params.phone, { blacklisted: Boolean(req.body.blacklisted), reason: v.str(req.body.reason, { max: 200 }), note: v.str(req.body.note, { max: 1000 }) });
  audit(req, req.body.blacklisted ? 'customer_blacklisted' : 'customer_flag_updated', { entity: 'customer', entityId: r.phone });
  res.json(r);
});

// ——— شركات التوصيل ———
export const carriersRouter = Router();

carriersRouter.get('/', (req, res) => {
  const scope = projectScope(req);
  res.json(scope.id ? shipments.configuredCarriers(scope.id) : Object.entries(CARRIERS).map(([key, c]) => ({ key, name: c.name, configured: null })));
});

carriersRouter.get('/performance', (req, res) => res.json(analytics.carrierPerformance(projectScope(req).ids, { windowDays: Number(req.query.days) || undefined })));

carriersRouter.get('/recommend', (req, res) => {
  const scope = projectScope(req);
  const w = Number(req.query.wilaya);
  if (!w) throw badRequest('wilaya_required');
  res.json(analytics.recommendCarrier(scope.ids, w, req.query.delivery_type === 'desk' ? 'desk' : 'home'));
});

carriersRouter.get('/best-by-wilaya', (req, res) => res.json(analytics.bestByWilaya(projectScope(req).ids, req.query.delivery_type === 'desk' ? 'desk' : 'home')));

carriersRouter.get('/tariffs', (req, res) => res.json(shipments.tariffs(projectScope(req, { allowAll: false }).id)));

carriersRouter.put('/tariffs', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  for (const t of (req.body.tariffs || []).slice(0, 500))
    shipments.setTariff(scope.id, t.carrier, t.wilaya_code, { home_fee: v.num(t.home_fee, { min: 0 }), desk_fee: v.num(t.desk_fee, { min: 0 }), return_fee: v.num(t.return_fee, { min: 0 }) });
  audit(req, 'tariffs_changed', { projectId: scope.id });
  res.json({ ok: true });
});

carriersRouter.post('/tariffs/refresh', async (req, res) => res.json(await shipments.refreshTariffs(projectScope(req, { allowAll: false }).id)));

carriersRouter.post('/sync-tracking', async (req, res) => {
  const scope = projectScope(req);
  const out = {};
  for (const id of scope.ids) {
    try {
      out[id] = await runJob('tracking', id, 'تتبع الطرود', () => shipments.syncTracking(id));
    } catch (e) {
      out[id] = { error: e.message };
    }
  }
  res.json(out);
});

carriersRouter.get('/:carrier/communes', async (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  const c = getCarrier(req.params.carrier);
  const w = Number(req.query.wilaya);
  res.json(await c.communes(projectConfig(scope.id), w));
});

carriersRouter.get('/:carrier/desks', async (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  const c = getCarrier(req.params.carrier);
  res.json(await c.desks(projectConfig(scope.id), Number(req.query.wilaya)));
});

export { getProject };

// ——— المرتجعات: ما عاد إلى المخزون (Shopify والـ ERP) وما تلف أو ضاع ———
export const returnsRouter = Router();

returnsRouter.get('/summary', (req, res) => res.json(returns.summary(projectScope(req).ids)));

returnsRouter.get('/legacy', (req, res) => res.json(returns.legacyReturns(projectScope(req).ids)));

// مرتجعات سبقت الدفتر: إعادتها الآن أو تسجيلها كمُعادة يدوياً — تغيير مخزون جماعي ⇒ كلمة المرور الحساسة
returnsRouter.post('/legacy', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const scope = projectScope(req);
  const out = returns.processLegacy(scope.ids, req.body.order_ids, { alreadyRestocked: req.body.already_restocked === true, userId: req.user.id });
  audit(req, 'returns_legacy', { details: { ...out, already_restocked: req.body.already_restocked === true } });
  res.json(out);
});

const scopedReturn = (req) => {
  const r = db.prepare('SELECT * FROM order_returns WHERE id = ?').get(Number(req.params.id));
  if (!r || !projectScope(req).ids.includes(r.project_id)) throw new HttpError(404, 'return_not_found');
  return r;
};

returnsRouter.patch('/:id', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const r = scopedReturn(req);
  const out = returns.updateReturn(r.id, { items: req.body.items, note: req.body.note }, { userId: req.user.id });
  audit(req, 'return_updated', { entity: 'order', entityId: r.order_id, projectId: r.project_id, details: { items: (req.body.items || []).map((i) => ({ idx: i.idx, back: i.back, loss: i.loss })) } });
  res.json(out);
});

returnsRouter.post('/:id/retry', requireRole('admin', 'manager'), async (req, res) => {
  const r = scopedReturn(req);
  res.json(await returns.retryNow(r.id));
});
