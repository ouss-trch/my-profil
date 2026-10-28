/** خطأ تكامل خارجي مع تصنيف يفهمه المستخدم (شبكة / صلاحيات / حد الطلبات / بيانات) */
export class IntegrationError extends Error {
  constructor(service, kind, message, details) {
    super(`${service}: ${message}`);
    this.service = service;
    this.kind = kind; // network | auth | rate_limit | not_found | invalid | server | config
    this.details = details;
  }
}

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ENETUNREACH']);

/**
 * fetch مع مهلة وإعادة محاولة لأخطاء الشبكة و429/5xx فقط.
 * يعيد { status, data, headers } أو يرمي IntegrationError.
 */
export async function request(service, url, { method = 'GET', headers = {}, body, timeoutMs = 30000, retries = 2, raw = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const init = { method, headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal };
      if (body !== undefined) {
        if (typeof body === 'string' || body instanceof URLSearchParams || body instanceof FormData || Buffer.isBuffer(body)) init.body = body;
        else {
          init.body = JSON.stringify(body);
          init.headers['Content-Type'] = 'application/json';
        }
      }
      const res = await fetch(url, init);
      if (raw) return res;
      const text = await res.text();
      let data = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* نص عادي */
      }
      if (res.ok) return { status: res.status, data, headers: res.headers };
      const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : 'invalid';
      const msg = extractMessage(data) || `HTTP ${res.status}`;
      lastErr = new IntegrationError(service, kind, msg, { status: res.status, data });
      if ((kind === 'rate_limit' || kind === 'server') && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw lastErr;
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      const code = e.cause?.code || e.code;
      const isNet = e.name === 'AbortError' || NETWORK_CODES.has(code) || e.name === 'TypeError';
      lastErr = new IntegrationError(service, isNet ? 'network' : 'invalid', isNet ? 'network_unreachable' : e.message);
      if (isNet && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function extractMessage(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  return String(
    data.error?.message || data.error?.error_user_msg || data.errors?.[0]?.message || data.message || (typeof data.error === 'string' ? data.error : '') || (data.errors ? JSON.stringify(data.errors) : ''),
  ).slice(0, 300);
}
