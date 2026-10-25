import crypto from 'node:crypto';

// الجزائر على UTC+1 طوال السنة (لا توقيت صيفي)
export const DZ_OFFSET_MS = 3600e3;

export const nowIso = () => new Date().toISOString();

/** تاريخ اليوم بتوقيت الجزائر YYYY-MM-DD */
export function dzDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + DZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** بداية يوم جزائري (YYYY-MM-DD) كتوقيت UTC ISO */
export function dzDayStartIso(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DZ_OFFSET_MS).toISOString();
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) ? ms / 86400e3 : null;
}

const AR_DIGITS = /[٠-٩۰-۹]/g;
export const latinDigits = (s) =>
  String(s ?? '').replace(AR_DIGITS, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });

/** رقم هاتف جزائري بصيغة 0XXXXXXXXX، أو null إن كان غير صالح */
export function normalizePhone(input) {
  let p = latinDigits(input).replace(/[^\d+]/g, '');
  p = p.replace(/^(?:\+|00)?213/, '0');
  if (/^[567]\d{8}$/.test(p)) p = '0' + p;
  if (/^0[2-9]\d{7}$/.test(p)) return p; // هاتف ثابت (9 أرقام)
  return /^0[567]\d{8}$/.test(p) ? p : null;
}

export const phoneIntl = (p) => {
  const n = normalizePhone(p);
  return n ? '213' + n.slice(1) : '';
};

export const round = (n, d = 0) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

export const num = (v, fallback = 0) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const s = latinDigits(v).replace(/٫/g, '.').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

export const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** يزيل الحركات ويحوّل النص لمقارنة متسامحة (فرنسي/عربي) */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ْ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// تحويل الحروف العربية إلى لاتينية لبناء روابط (handle) مقروءة
const AR_LATIN = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z',
  س: 's', ش: 'ch', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', ة: 'a', و: 'ou', ي: 'i', ى: 'a', ئ: 'i', ؤ: 'ou', ء: '', پ: 'p', ڤ: 'v', گ: 'g',
};

export function transliterate(s) {
  return String(s ?? '')
    .replace(/[ً-ْـ]/g, '')
    .split('')
    .map((ch) => (AR_LATIN[ch] !== undefined ? AR_LATIN[ch] : ch))
    .join('');
}

/** handle لـ Shopify: حروف لاتينية صغيرة وأرقام وشرطات، بطول معقول */
export function slugify(s, maxLen = 60) {
  const out = fold(transliterate(latinDigits(s)))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  if (out.length <= maxLen) return out;
  return out.slice(0, maxLen).replace(/-[^-]*$/, '') || out.slice(0, maxLen);
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const stripHtml = (html) =>
  String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, details) => new HttpError(400, code, code, details);
export const notFound = (code = 'not_found') => new HttpError(404, code, code);

/** تحقق بسيط من مدخلات الطلبات: يعيد قيمة نظيفة أو يرمي 400 */
export const v = {
  str(val, { max = 500, required = false, name = 'field' } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw badRequest(`${name}_required`);
      return null;
    }
    const s = String(val).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (required && !s) throw badRequest(`${name}_required`);
    return s.slice(0, max);
  },
  int(val, { min = -Infinity, max = Infinity, required = false, name = 'field' } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw badRequest(`${name}_required`);
      return null;
    }
    const n = Number(val);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name}_invalid`);
    return n;
  },
  num(val, { min = -Infinity, max = Infinity, required = false, name = 'field' } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw badRequest(`${name}_required`);
      return null;
    }
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${name}_invalid`);
    return n;
  },
  oneOf(val, list, { required = false, name = 'field' } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw badRequest(`${name}_required`);
      return null;
    }
    if (!list.includes(val)) throw badRequest(`${name}_invalid`);
    return val;
  },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
