/**
 * طبقة الاتصال بالخادم:
 * - تُرسل المشروع الحالي في X-Project
 * - عند 428 (عملية حساسة) تطلب كلمة المرور من نافذة عامة ثم تعيد المحاولة
 * - عند 401 تُعيد المستخدم لصفحة الدخول
 */
export class ApiError extends Error {
  constructor(status, code, details, extra = {}) {
    super(code || `http_${status}`);
    this.status = status;
    this.code = code;
    this.details = details;
    Object.assign(this, extra);
  }
}

const state = { project: 'all', askSensitive: null, onUnauthorized: null };

export const setApiProject = (p) => (state.project = p ?? 'all');
export const getApiProject = () => state.project;
export const setSensitiveAsker = (fn) => (state.askSensitive = fn);
export const setUnauthorizedHandler = (fn) => (state.onUnauthorized = fn);

async function send(path, { method = 'GET', body, project, password, signal }) {
  const headers = {};
  const p = project === undefined ? state.project : project;
  if (p !== null && p !== undefined) headers['X-Project'] = String(p);
  if (password) headers['X-Confirm-Password'] = encodeURIComponent(password);
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal });
}

export async function api(path, opts = {}) {
  let password = opts.password;
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await send(path, { ...opts, password });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ApiError(0, 'network_error');
    }
    if (res.status === 428 || (res.status === 403 && password)) {
      const data = await res.json().catch(() => ({}));
      if (data.error !== 'sensitive_password_required' && data.error !== 'sensitive_password_wrong') throw new ApiError(res.status, data.error, data.details);
      if (!state.askSensitive) throw new ApiError(res.status, data.error);
      password = await state.askSensitive({ wrong: data.error === 'sensitive_password_wrong', reason: opts.reason });
      if (!password) throw new ApiError(499, 'cancelled');
      lastError = data.error;
      continue;
    }
    if (res.status === 401 && !path.startsWith('/auth/')) {
      state.onUnauthorized?.();
      throw new ApiError(401, 'unauthorized');
    }
    if (opts.raw) {
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
      return res;
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error || `http_${res.status}`, data?.details, { service: data?.service, kind: data?.kind });
    return data;
  }
  throw new ApiError(429, lastError || 'too_many_attempts');
}

api.get = (path, opts) => api(path, { ...opts, method: 'GET' });
api.post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
api.put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
api.patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
api.del = (path, opts) => api(path, { ...opts, method: 'DELETE' });

export const qs = (obj) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
