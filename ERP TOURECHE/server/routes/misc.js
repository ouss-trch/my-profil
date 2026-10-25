import { Router } from 'express';
import { db } from '../db/index.js';
import { requireRole, requireSensitive } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { HttpError, addDays, dzDay, nowIso, v } from '../lib/util.js';
import { projectScope, inList } from '../services/projects.js';
import * as analytics from '../services/analytics.js';
import * as assistant from '../services/assistant.js';
import * as contacts from '../services/contacts.js';

export const dashboardRouter = Router();

dashboardRouter.get('/today', (req, res) => res.json(analytics.today(projectScope(req).ids)));

dashboardRouter.get('/brief', async (req, res) => res.json({ text: await assistant.dailyBrief(projectScope(req).ids) }));

dashboardRouter.get('/stats', (req, res) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : dzDay();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : addDays(to, -29);
  if (from > to) throw new HttpError(400, 'range_invalid');
  res.json(analytics.stats(projectScope(req).ids, from, to));
});

// ——— المساعد الذكي ———
export const aiRouter = Router();

aiRouter.post('/chat', async (req, res) => {
  const scope = projectScope(req);
  res.json(await assistant.chat({ userId: req.user.id, conversationId: req.body.conversation_id || null, message: v.str(req.body.message, { required: true, max: 8000, name: 'message' }), projectId: scope.all ? null : scope.id }));
});

aiRouter.get('/conversations', (req, res) => res.json(assistant.listConversations(req.user.id)));
aiRouter.get('/conversations/:id', (req, res) => res.json(assistant.transcript(req.params.id, req.user.id)));

aiRouter.post('/actions/:id/confirm', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const out = await assistant.executeAction(req.params.id, req.user);
  audit(req, 'ai_action_executed', { entity: 'ai_action', entityId: req.params.id, details: { kind: out.kind, result: out.result } });
  res.json(out);
});

aiRouter.post('/actions/:id/reject', (req, res) => {
  assistant.rejectAction(req.params.id);
  res.json({ ok: true });
});

// ——— المهام ———
export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  const scope = projectScope(req);
  const where = [`(t.project_id IS NULL OR t.project_id IN (${inList(scope.ids)}))`];
  const args = [...scope.ids];
  if (req.query.status) {
    where.push('t.status = ?');
    args.push(req.query.status);
  }
  if (req.query.mine === '1') {
    where.push('t.assigned_to = ?');
    args.push(req.user.id);
  }
  res.json(
    db
      .prepare(
        `SELECT t.*, u.display_name AS assignee_name, p.name AS project_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN projects p ON p.id = t.project_id
         WHERE ${where.join(' AND ')} ORDER BY (t.status = 'done'), COALESCE(t.due_at, '9999'), t.id DESC LIMIT 500`,
      )
      .all(...args),
  );
});

const taskInput = (b) => ({
  title: v.str(b.title, { max: 200 }),
  notes: v.str(b.notes, { max: 4000 }),
  status: v.oneOf(b.status, ['todo', 'doing', 'done']),
  priority: v.oneOf(b.priority, ['low', 'normal', 'high']),
  due_at: v.str(b.due_at, { max: 30 }),
  assigned_to: b.assigned_to ? Number(b.assigned_to) : null,
  project_id: b.project_id ? Number(b.project_id) : null,
  entity_type: v.oneOf(b.entity_type, ['order', 'product', 'customer', 'campaign']),
  entity_id: b.entity_id ? Number(b.entity_id) : null,
});

tasksRouter.post('/', (req, res) => {
  const t = taskInput(req.body);
  if (!t.title) throw new HttpError(400, 'title_required');
  const info = db
    .prepare('INSERT INTO tasks (project_id, title, notes, status, priority, due_at, assigned_to, entity_type, entity_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(t.project_id, t.title, t.notes, t.status || 'todo', t.priority || 'normal', t.due_at, t.assigned_to, t.entity_type, t.entity_id, req.user.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

tasksRouter.patch('/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.id));
  if (!cur) throw new HttpError(404, 'task_not_found');
  const t = taskInput(req.body);
  const next = Object.fromEntries(Object.entries(t).map(([k, val]) => [k, req.body[k] === undefined ? cur[k] : val]));
  db.prepare('UPDATE tasks SET project_id = ?, title = ?, notes = ?, status = ?, priority = ?, due_at = ?, assigned_to = ?, entity_type = ?, entity_id = ?, done_at = ? WHERE id = ?').run(
    next.project_id,
    next.title || cur.title,
    next.notes,
    next.status || cur.status,
    next.priority || cur.priority,
    next.due_at,
    next.assigned_to,
    next.entity_type,
    next.entity_id,
    next.status === 'done' && cur.status !== 'done' ? nowIso() : next.status === 'done' ? cur.done_at : null,
    cur.id,
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(cur.id));
});

tasksRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ——— الموردون والشركاء (مربوطون بالمخزون والطرود العالقة) ———
export const contactsRouter = Router();

contactsRouter.get('/', (req, res) => {
  const scope = projectScope(req);
  res.json(contacts.listContacts(scope.ids, { q: String(req.query.q || ''), kind: req.query.kind || undefined, carrier: req.query.carrier || undefined, wilaya: req.query.wilaya || undefined }));
});

contactsRouter.post('/', (req, res) => {
  const c = contacts.contactInput(req.body);
  const info = db
    .prepare('INSERT INTO contacts (project_id, name, kind, company, phone, email, notes, carrier, wilaya_code, role, lead_time_days) VALUES (@project_id, @name, @kind, @company, @phone, @email, @notes, @carrier, @wilaya_code, @role, @lead_time_days)')
    .run(c);
  audit(req, 'contact_created', { entity: 'contact', entityId: info.lastInsertRowid, details: { name: c.name, kind: c.kind } });
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid));
});

contactsRouter.patch('/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(req.params.id));
  if (!cur) throw new HttpError(404, 'contact_not_found');
  const c = { id: cur.id, ...contacts.contactInput({ ...cur, ...req.body }) };
  db.prepare(
    'UPDATE contacts SET project_id = @project_id, name = @name, kind = @kind, company = @company, phone = @phone, email = @email, notes = @notes, carrier = @carrier, wilaya_code = @wilaya_code, role = @role, lead_time_days = @lead_time_days WHERE id = @id',
  ).run(c);
  if (c.kind !== 'supplier') db.prepare('UPDATE products SET supplier_id = NULL WHERE supplier_id = ?').run(cur.id);
  else if (c.name !== cur.name) db.prepare('UPDATE products SET supplier = ? WHERE supplier_id = ?').run(c.name, cur.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(cur.id));
});

contactsRouter.delete('/:id', requireSensitive, (req, res) => {
  const cur = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(req.params.id));
  if (!cur) throw new HttpError(404, 'contact_not_found');
  db.prepare('DELETE FROM contacts WHERE id = ?').run(cur.id);
  audit(req, 'contact_deleted', { entity: 'contact', entityId: cur.id, details: { name: cur.name } });
  res.json({ ok: true });
});

// ——— المالية ———
export const financeRouter = Router();

financeRouter.get('/', (req, res) => {
  const scope = projectScope(req);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : dzDay();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : `${to.slice(0, 8)}01`;
  const s = analytics.stats(scope.ids, from, to);
  const expenses = db
    .prepare(`SELECT e.*, p.name AS project_name FROM expenses e JOIN projects p ON p.id = e.project_id WHERE e.project_id IN (${inList(scope.ids)}) AND e.date >= ? AND e.date <= ? ORDER BY e.date DESC`)
    .all(...scope.ids, from, to);
  const byCategory = Object.values(expenses.reduce((m, e) => ((m[e.category] ||= { category: e.category, amount: 0 }).amount += e.amount, m), {}));
  res.json({ from, to, finance: s.finance, series: s.series, funnel: s.funnel, expenses, by_category: byCategory, products: s.products.slice(0, 20) });
});

financeRouter.post('/expenses', requireRole('admin', 'manager'), (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date)) ? req.body.date : dzDay();
  const amount = v.num(req.body.amount, { required: true, min: 0, max: 1e9, name: 'amount' });
  const category = v.str(req.body.category, { required: true, max: 60, name: 'category' });
  const info = db.prepare('INSERT INTO expenses (project_id, date, category, amount, note) VALUES (?, ?, ?, ?, ?)').run(scope.id, date, category, amount, v.str(req.body.note, { max: 500 }));
  audit(req, 'expense_added', { entity: 'expense', entityId: info.lastInsertRowid, projectId: scope.id, details: { amount, category } });
  res.json({ id: Number(info.lastInsertRowid) });
});

financeRouter.delete('/expenses/:id', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(req.params.id));
  if (!e) throw new HttpError(404, 'expense_not_found');
  db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
  audit(req, 'expense_deleted', { entity: 'expense', entityId: e.id, projectId: e.project_id, details: { amount: e.amount, category: e.category } });
  res.json({ ok: true });
});
