import { db } from '../db/index.js';

const stmt = db.prepare('INSERT INTO audit_log (user_id, project_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)');

/** سجل النشاط: كل عملية حساسة أو تغيير إعدادات يُسجَّل هنا (بدون أسرار) */
export function audit(req, action, { entity = null, entityId = null, projectId = null, details = null } = {}) {
  stmt.run(
    req?.user?.id ?? null,
    projectId ?? req?.project?.id ?? null,
    action,
    entity,
    entityId === null ? null : String(entityId),
    details ? JSON.stringify(details).slice(0, 4000) : null,
    req?.ip ?? null,
  );
}
