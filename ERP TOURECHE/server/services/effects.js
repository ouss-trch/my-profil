/**
 * طابور بسيط للأعمال الجانبية (وسوم Shopify، كتابة الجدول، CAPI، n8n) حتى لا تُبطئ واجهة المستخدم
 * ولا تُغرق الواجهات الخارجية بطلبات متزامنة. التنفيذ تسلسلي لكل مفتاح.
 */
const chains = new Map();
const failures = [];

export function enqueue(key, label, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev
    .then(fn)
    .catch((e) => {
      failures.unshift({ at: new Date().toISOString(), key, label, error: e.message });
      failures.length = Math.min(failures.length, 100);
      console.warn(`[effect] ${label} failed:`, e.message);
    })
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
  return next;
}

export const recentFailures = () => failures.slice(0, 50);

/** للاختبارات: انتظار انتهاء كل الأعمال الجانبية */
export const drain = () => Promise.all([...chains.values()]);
