import { db } from '../db/index.js';
import { HttpError, slugify } from '../lib/util.js';

export const listProjects = (includeInactive = false) =>
  db.prepare(`SELECT * FROM projects ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY position, id`).all();

export const getProject = (id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

export function createProject({ name, slug, domain, color, currency = 'DZD' }) {
  const s = slugify(slug || name, 40) || `p${Date.now()}`;
  if (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(s)) throw new HttpError(409, 'slug_taken');
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM projects').get().p;
  const info = db.prepare('INSERT INTO projects (slug, name, domain, color, currency, position) VALUES (?, ?, ?, ?, ?, ?)').run(s, name, domain || null, color || '#0E6B63', currency, pos);
  return getProject(info.lastInsertRowid);
}

export function updateProject(id, { name, domain, color, active }) {
  const p = getProject(id);
  if (!p) throw new HttpError(404, 'project_not_found');
  db.prepare('UPDATE projects SET name = ?, domain = ?, color = ?, active = ? WHERE id = ?').run(
    name ?? p.name,
    domain === undefined ? p.domain : domain,
    color ?? p.color,
    active === undefined ? p.active : active ? 1 : 0,
    id,
  );
  return getProject(id);
}

export function deleteProject(id) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  if (n <= 1) throw new HttpError(400, 'last_project');
  db.transaction(() => {
    db.prepare("DELETE FROM settings WHERE scope = ?").run(`project:${id}`);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  })();
}

/**
 * يحدد المشروع النشط من الترويسة X-Project أو ?project=…
 * «all» = كل المشاريع (للعرض والإحصاءات فقط).
 */
export function projectScope(req, { allowAll = true } = {}) {
  const raw = req.headers['x-project'] ?? req.query.project;
  if ((raw === 'all' || raw === undefined || raw === '') && allowAll) {
    const ids = listProjects().map((p) => p.id);
    return { all: true, ids, id: ids.length === 1 ? ids[0] : null };
  }
  const id = Number(raw);
  const p = Number.isInteger(id) ? getProject(id) : null;
  if (!p) throw new HttpError(400, 'project_required');
  return { all: false, ids: [p.id], id: p.id, project: p };
}

export const inList = (ids) => (ids.length ? ids.map(() => '?').join(',') : 'NULL');
