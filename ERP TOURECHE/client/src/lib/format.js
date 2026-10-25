// تنسيق الأرقام والتواريخ — بأرقام لاتينية في اللغتين (أوضح في التجارة الجزائرية)
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

// الفاصل U+202F (فاصل ضيق) يُبقي أرقام الآلاف متصلة داخل النص العربي، والمبالغ تُعزل اتجاهياً (LRI…PDI)
const iso = (s) => `\u2066${s}\u2069`;
const nnbsp = (s) => s.replace(/[\u00a0 ]/g, '\u202f');
export const n0 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : nnbsp(nf.format(Number(v))));
export const n2 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : nnbsp(nf2.format(Number(v))));
export const da = (v) => (v === null || v === undefined ? '—' : iso(`${n0(v)} DA`));
export const pct = (v, digits = 0) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(digits)}%`);
export const money = (v, cur) => (v === null || v === undefined ? '—' : iso(`${n2(v)} ${cur || ''}`.trim()));

const TZ = 'Africa/Algiers';
export const dateTime = (iso, lang = 'ar') =>
  iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const dateOnly = (iso, lang = 'ar') =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const shortDay = (iso, lang = 'ar') => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { timeZone: TZ, day: '2-digit', month: 'short' }) : '');

export function ago(iso, lang = 'ar') {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'fr', { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(-Math.round(s), 'second');
  if (abs < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  return dateOnly(iso, lang);
}

export const todayDz = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

// روابط الهاتف: واتساب للأرقام النقالة الجزائرية فقط (05/06/07)
export const isMobileDz = (p) => /^0[567]\d{8}$/.test(String(p || ''));
export const waLink = (phone, text) => (isMobileDz(phone) ? `https://wa.me/213${String(phone).slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null);
