import { Router } from 'express';
import { requireRole, requireSensitive, parseCookies } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { HttpError, v } from '../lib/util.js';
import { projectScope } from '../services/projects.js';
import * as advisor from '../services/advisor.js';
import * as splits from '../services/splits.js';

// ——— المستشار: ملاحظات، تقييمات، استنتاجات، اقتراحات + دفتر الملاحظات + تقرير ذكي ———
export const advisorRouter = Router();

advisorRouter.get('/', (req, res) => res.json(advisor.analyze(projectScope(req).ids)));

advisorRouter.put('/insights/state', (req, res) => {
  const scope = projectScope(req);
  const key = v.str(req.body.key, { required: true, max: 200, name: 'key' });
  const status = req.body.status ? v.oneOf(req.body.status, ['done', 'dismissed', 'snoozed'], { name: 'status' }) : null;
  advisor.setInsightState(req.body.project_id ? Number(req.body.project_id) : scope.all ? 0 : scope.id, key, {
    status,
    days: v.int(req.body.days, { min: 1, max: 60 }),
    note: v.str(req.body.note, { max: 1000 }),
    userId: req.user.id,
  });
  res.json({ ok: true });
});

advisorRouter.get('/journal', (req, res) => res.json(advisor.journal(projectScope(req).ids, { kind: req.query.kind || null })));

advisorRouter.post('/journal', (req, res) => {
  const scope = projectScope(req);
  res.json(
    advisor.addJournal({
      projectId: req.body.project_id ? Number(req.body.project_id) : scope.all ? null : scope.id,
      kind: v.oneOf(req.body.kind || 'note', ['note', 'lesson', 'idea', 'decision', 'experiment'], { name: 'kind' }),
      text: v.str(req.body.text, { required: true, max: 4000, name: 'text' }),
      entityType: v.oneOf(req.body.entity_type, ['order', 'product', 'campaign', 'split', 'carrier']),
      entityId: req.body.entity_id ? Number(req.body.entity_id) : null,
      userId: req.user.id,
    }),
  );
});

advisorRouter.patch('/journal/:id', (req, res) => {
  const out = advisor.updateJournal(Number(req.params.id), {
    text: req.body.text === undefined ? undefined : v.str(req.body.text, { required: true, max: 4000, name: 'text' }),
    kind: req.body.kind === undefined ? undefined : v.oneOf(req.body.kind, ['note', 'lesson', 'idea', 'decision', 'experiment'], { name: 'kind' }),
    pinned: req.body.pinned,
  });
  if (!out) throw new HttpError(404, 'note_not_found');
  res.json(out);
});

advisorRouter.delete('/journal/:id', requireSensitive, (req, res) => {
  if (!advisor.deleteJournal(Number(req.params.id))) throw new HttpError(404, 'note_not_found');
  audit(req, 'journal_deleted', { entity: 'journal', entityId: req.params.id });
  res.json({ ok: true });
});

advisorRouter.get('/reports', (req, res) => res.json(advisor.reports(projectScope(req).ids)));

advisorRouter.post('/reports', requireRole('admin', 'manager'), async (req, res) => {
  const out = await advisor.aiReport(projectScope(req).ids, { userId: req.user.id, lang: req.body.lang === 'fr' ? 'fr' : 'ar', focus: v.str(req.body.focus, { max: 500 }) });
  res.json(out);
});

// ——— اختبارات صفحات الهبوط A/B ———
export const splitsRouter = Router();
const pid = (req) => projectScope(req, { allowAll: false }).id;

splitsRouter.get('/', (req, res) => res.json(splits.listTests(projectScope(req).ids)));
splitsRouter.get('/:id', (req, res) => res.json(splits.results(Number(req.params.id))));

splitsRouter.post('/', requireRole('admin', 'manager'), (req, res) => {
  const t = splits.createTest(pid(req), req.body || {});
  audit(req, 'split_created', { entity: 'split', entityId: t.id, projectId: t.project_id, details: { slug: t.slug } });
  res.json(t);
});

splitsRouter.patch('/:id', requireRole('admin', 'manager'), (req, res) => {
  const t = splits.updateTest(Number(req.params.id), req.body || {});
  audit(req, 'split_updated', { entity: 'split', entityId: t.id, projectId: t.project_id, details: { status: req.body.status, variants: Array.isArray(req.body.variants) } });
  res.json(t);
});

splitsRouter.delete('/:id', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  splits.deleteTest(Number(req.params.id));
  audit(req, 'split_deleted', { entity: 'split', entityId: req.params.id });
  res.json({ ok: true });
});

/** الرابط العام الذي يوضع في الإعلان: ‎/go/:slug‎ (بدون تسجيل دخول) */
export function goHandler(req, res) {
  const out = splits.route(req.params.slug, { cookies: parseCookies(req.headers.cookie), query: req.query, userAgent: req.headers['user-agent'] || '' });
  if (!out) return res.status(404).type('text').send('Not found');
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  for (const c of out.cookies) res.cookie(c.name, c.value, { maxAge: c.maxAge * 1000, httpOnly: true, sameSite: 'lax', secure, path: '/go' });
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  res.redirect(302, out.location);
}
