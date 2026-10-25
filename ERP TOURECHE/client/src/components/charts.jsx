import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '../i18n/index.jsx';
import { n0, shortDay } from '../lib/format.js';

/** سلاسل بألوان ثابتة الترتيب (لوحة مُتحقق منها لعمى الألوان): 1 أزرق، 2 برتقالي، 3 أخضر مائي، 4 أصفر */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

function Tip({ active, payload, label, series, unit, lang }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card min-w-[150px] px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-semibold text-ink">{/^\d{4}-\d{2}-\d{2}$/.test(label) ? shortDay(label, lang) : label}</div>
      {series.map((s, i) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-sub">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color || SERIES[i] }} />
              {s.label}
            </span>
            <span className="num font-medium text-ink">
              {n0(p.value)}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: s.color || SERIES[i], height: 2 }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** منحنى زمني (حتى 4 سلاسل بنفس الوحدة — محور واحد دائماً) */
export function TrendChart({ data, series, height = 240, unit, area = false, xKey = 'day' }) {
  const { lang, dir } = useI18n();
  const Chart = area ? AreaChart : LineChart;
  return (
    <div>
      <Legend series={series} />
      <div style={{ height }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey={xKey} tickFormatter={(d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? shortDay(d, lang) : d)} tickLine={false} minTickGap={18} reversed={dir === 'rtl'} />
            <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={(v) => n0(v)} orientation={dir === 'rtl' ? 'right' : 'left'} allowDecimals={false} />
            <Tooltip content={<Tip series={series} unit={unit} lang={lang} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
            {series.map((s, i) =>
              area ? (
                <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color || SERIES[i]} fill={s.color || SERIES[i]} fillOpacity={0.12} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ) : (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color || SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** أعمدة يومية (سلسلة أو سلسلتان متجاورتان) */
export function BarsChart({ data, series, height = 220, unit, xKey = 'day' }) {
  const { lang, dir } = useI18n();
  return (
    <div>
      <Legend series={series} />
      <div style={{ height }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={(d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? shortDay(d, lang) : d)} tickLine={false} minTickGap={12} reversed={dir === 'rtl'} />
            <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={(v) => n0(v)} orientation={dir === 'rtl' ? 'right' : 'left'} />
            <Tooltip content={<Tip series={series} unit={unit} lang={lang} />} cursor={{ fill: 'rgb(var(--line) / 0.35)' }} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} fill={s.color || SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** قائمة أشرطة أفقية مرتبة (الولايات، المنتجات، المصادر) — قيم مكتوبة بجانب كل شريط */
export function BarList({ rows, valueLabel, max, format = n0, tone = 'var(--series-1)', onClick }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value || 0));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" disabled={!onClick} onClick={() => onClick?.(r)} className="w-full text-start disabled:cursor-default">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink">{r.label}</span>
              <span className="num shrink-0 text-sub">
                {format(r.value)}
                {r.extra ? <span className="ms-2 text-muted">{r.extra}</span> : null}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (100 * (r.value || 0)) / top)}%`, background: r.color || tone }} />
            </div>
          </button>
        </li>
      ))}
      {valueLabel && <li className="pt-1 text-[11px] text-muted">{valueLabel}</li>}
    </ul>
  );
}
