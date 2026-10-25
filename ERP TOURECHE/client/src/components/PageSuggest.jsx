import { useApi } from '../lib/hooks.js';

/** اقتراحات من الصفحات المثبّتة لحقول الروابط (اختبارات A/B، رابط الحملة) */
export default function PageSuggest({ id, field = 'url' }) {
  const { data } = useApi('/pages?pinned=1');
  const rows = data?.rows || [];
  if (!rows.length) return null;
  return (
    <datalist id={id}>
      {rows.map((p) => (
        <option key={p.id} value={field === 'path' ? decodeURI(new URL(p.url).pathname) + new URL(p.url).search : p.url}>
          {p.title}
        </option>
      ))}
    </datalist>
  );
}
