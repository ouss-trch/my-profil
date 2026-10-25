import { fold } from '../../lib/util.js';

/** «2024-01-15 12:45:04» بتوقيت الجزائر → ISO UTC */
export function dzLocalToIso(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d\d:?\d\d)$/.test(str)) return new Date(str).toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+01:00`).toISOString();
  const m2 = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(str);
  if (m2) return new Date(`${m2[3]}-${m2[2]}-${m2[1]}T${m2[4] || '12'}:${m2[5] || '00'}:00+01:00`).toISOString();
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** أفضل تطابق لاسم بلدية ضمن قائمة الشركة (مطابقة متسامحة للحروف والحركات) */
export function matchCommune(name, list, key = (x) => x.name) {
  const target = fold(name).replace(/[^a-z0-9؀-ۿ]/g, '');
  if (!target) return null;
  const norm = (x) => fold(key(x)).replace(/[^a-z0-9؀-ۿ]/g, '');
  return list.find((x) => norm(x) === target) || list.find((x) => norm(x).startsWith(target) || target.startsWith(norm(x))) || null;
}

export const productLine = (items) =>
  (items || [])
    .map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} x${i.qty || 1}`)
    .join(' + ')
    .slice(0, 250) || 'Produit';
