// وضع العرض: الواجهة الحقيقية نفسها بردود مسجّلة من خادم الـ ERP (بيانات تجريبية)، والتعديلات معطّلة.
export const DEMO = import.meta.env.VITE_DEMO === '1';

let store = null;
async function load() {
  if (!store) store = fetch('./demo-data.json').then((r) => r.json());
  return store;
}

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** يُرجع الرد المسجّل لنفس المسار (مع المعاملات أو دونها) */
export async function demoGet(path) {
  const data = await load();
  if (path in data) return clone(data[path]);
  const bare = path.split('?')[0];
  if (bare in data) return clone(data[bare]);
  const hit = Object.keys(data).find((k) => k.split('?')[0] === bare);
  if (hit) return clone(data[hit]);
  // تفاصيل عنصر غير مسجّل (طلبية، منتج…) → أول عنصر مسجّل من نفس النوع
  const pattern = bare.replace(/\/\d+(\/|$)/, '/:id$1');
  const similar = Object.keys(data).find((k) => k.split('?')[0].replace(/\/\d+(\/|$)/, '/:id$1') === pattern);
  if (similar) return clone(data[similar]);
  return null;
}
