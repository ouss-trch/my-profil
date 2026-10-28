import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, Info, RefreshCw, Save, Truck } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { n0, n2, pct } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { CARRIER_NAMES } from '../components/status.jsx';
import { Badge, Bar, Button, Card, Empty, ErrorBox, Input, Loading, Segmented, Tabs, cx, rateTone, useAction } from '../components/ui.jsx';

const p100 = (x) => (x === null || x === undefined ? null : Math.round(x * 100));
const CONF = { high: ['ثقة عالية', 'Confiance haute', 'good'], medium: ['ثقة متوسطة', 'Confiance moyenne', 'info'], low: ['ثقة ضعيفة', 'Confiance faible', 'warn'], none: ['بلا بيانات', 'Sans données', 'neutral'] };

/** أداء شركات التوصيل + أفضل شركة لكل ولاية + الأسعار */
export default function Carriers() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'performance';
  const { run, busy } = useAction();
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Truck}
        title={t('nav.carriers')}
        subtitle={t(['Yalidine · NOEST · ZR Express — الأداء الحقيقي من طرودك، واقتراح الأفضل لكل ولاية', 'Yalidine · NOEST · ZR Express — performance réelle de vos colis et meilleur choix par wilaya'])}
        actions={
          <Button icon={RefreshCw} loading={busy === 'sync'} onClick={() => run('sync', () => api.post('/carriers/sync-tracking', {}), { success: t(['تم تحديث التتبع', 'Suivi actualisé']) })}>
            {t(['تحديث تتبع كل الطرود', 'Actualiser tous les suivis'])}
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'performance', label: t(['الأداء', 'Performance']) },
          { value: 'best', label: t(['أفضل شركة لكل ولاية', 'Meilleur par wilaya']), icon: Award },
          { value: 'tariffs', label: t(['الأسعار', 'Tarifs']) },
        ]}
      />
      {tab === 'performance' && <Performance />}
      {tab === 'best' && <BestByWilaya />}
      {tab === 'tariffs' && <Tariffs />}
    </div>
  );
}

function Performance() {
  const { t, lang } = useI18n();
  const { wilayaName } = useApp();
  const [days, setDays] = useState('120');
  const { data, error, loading, reload } = useApi(`/carriers/performance${qs({ days })}`);
  const [wq, setWq] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const wilayas = data.wilayas
    .filter((w) => !wq || wilayaName(w.wilaya_code, lang).toLowerCase().includes(wq.toLowerCase()))
    .sort((a, b) => b.carriers.reduce((s, c) => s + c.shipped, 0) - a.carriers.reduce((s, c) => s + c.shipped, 0));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-sub">{t(['النافذة', 'Fenêtre'])}:</span>
        <Segmented
          size="sm"
          value={days}
          onChange={setDays}
          options={[
            { value: '30', label: '30' },
            { value: '60', label: '60' },
            { value: '120', label: '120' },
            { value: '365', label: '365' },
          ]}
        />
        <span className="text-xs text-muted">{t('c.days')}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {data.carriers.map((c) => (
          <Card key={c.carrier} title={c.name}>
            {c.shipped ? (
              <div className="space-y-3 text-sm">
                <Metric label={t(['نسبة التسليم', 'Taux de livraison'])} value={p100(c.success_rate)} good={80} bad={65} />
                <Metric label={t(['جدية الموزع (محاولة قبل الإرجاع)', 'Sérieux du livreur (tentative avant retour)'])} value={p100(c.contact_rate)} good={85} bad={65} />
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <Mini label={t(['شُحن', 'Expédiés'])} value={n0(c.shipped)} />
                  <Mini label={t(['متوسط الأيام', 'Jours moy.'])} value={c.avg_days === null ? '—' : n2(c.avg_days)} />
                  <Mini label={t(['قيد التوصيل', 'En cours'])} value={n0(c.in_progress)} />
                  <Mini label={t(['مسلّمة', 'Livrés'])} value={n0(c.delivered)} />
                  <Mini label={t(['مرتجعة', 'Retours'])} value={n0(c.returned)} />
                  <Mini label={t(['تقييم الموزع', 'Note livreur'])} value={c.rating === null ? '—' : `${n2(c.rating)}/5`} />
                </div>
                {c.no_attempt_return_rate !== null && c.returned > 0 && (
                  <p className="text-xs text-sub">
                    {t(['مرتجعات دون أي محاولة اتصال:', 'Retours sans aucune tentative :'])} <b className={c.no_attempt_return_rate > 0.3 ? 'text-bad' : ''}>{pct(p100(c.no_attempt_return_rate))}</b>
                  </p>
                )}
              </div>
            ) : (
              <Empty icon={Truck} title={t(['لا طرود بعد', 'Aucun colis'])} />
            )}
          </Card>
        ))}
      </div>
      <Card
        title={t(['حسب الولاية', 'Par wilaya'])}
        pad={false}
        actions={<Input className="w-48 py-1.5" value={wq} onChange={(e) => setWq(e.target.value)} placeholder={t('c.search')} />}
      >
        {wilayas.length ? (
          <div className="max-h-[560px] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('c.wilaya')}</th>
                  {Object.keys(CARRIER_NAMES).map((k) => (
                    <th key={k} className="text-center">
                      {CARRIER_NAMES[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wilayas.map((w) => (
                  <tr key={w.wilaya_code}>
                    <td className="whitespace-nowrap">{wilayaName(w.wilaya_code, lang)}</td>
                    {Object.keys(CARRIER_NAMES).map((k) => {
                      const c = w.carriers.find((x) => x.carrier === k);
                      if (!c) return <td key={k} className="text-center text-muted">—</td>;
                      const sr = p100(c.success_rate);
                      return (
                        <td key={k} className="text-center text-xs">
                          <span className={cx('num font-semibold', sr === null ? 'text-muted' : sr >= 80 ? 'text-good' : sr >= 65 ? 'text-warn' : 'text-bad')}>{sr === null ? '…' : `${sr}%`}</span>
                          <div className="text-muted">
                            {c.delivered}/{c.closed} · {c.avg_days === null ? '—' : `${n2(c.avg_days)}${t(['ي', 'j'])}`}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </Card>
    </div>
  );
}

function BestByWilaya() {
  const { t, lang } = useI18n();
  const [type, setType] = useState('home');
  const { data, error, loading, reload } = useApi(`/carriers/best-by-wilaya${qs({ delivery_type: type })}`);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data || []).filter((r) => !q || `${r.wilaya.code} ${r.wilaya.ar} ${r.wilaya.fr}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const summary = useMemo(() => (data || []).filter((r) => r.shipped).reduce((m, r) => ((m[r.best] = (m[r.best] || 0) + 1), m), {}), [data]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'home', label: t('c.home') },
            { value: 'desk', label: t('c.desk') },
          ]}
        />
        <Input className="max-w-xs py-1.5" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c.search')} />
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(summary).map(([k, n]) => (
            <Badge key={k} tone="brand">
              {CARRIER_NAMES[k] || k}: {n}
            </Badge>
          ))}
        </div>
      </div>
      <p className="flex items-start gap-2 text-xs leading-5 text-sub">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t(
          ['التقييم = نسبة التسليم 45% + السرعة 25% + جدية الموزع 15% + السعر 15%. الولايات ذات الطرود القليلة تُدمج مع أداء الشركة العام حتى لا تخدعك 2–3 طرود.', 'Score = livraison 45 % + rapidité 25 % + sérieux 15 % + prix 15 %. Les wilayas à faible volume sont lissées avec la moyenne du transporteur.'],
        )}
      </p>
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data && (
        <Card pad={false}>
          <div className="max-h-[640px] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('c.wilaya')}</th>
                  <th>{t(['الأفضل', 'Meilleur'])}</th>
                  <th>{t(['الثقة', 'Confiance'])}</th>
                  <th>{t(['الترتيب (تقييم · تسليم · أيام · عدد)', 'Classement (score · livr. · jours · n)'])}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.wilaya.code}>
                    <td className="whitespace-nowrap">
                      {r.wilaya.code} - {lang === 'ar' ? r.wilaya.ar : r.wilaya.fr}
                    </td>
                    <td>
                      <Badge tone="good">{CARRIER_NAMES[r.best] || '—'}</Badge>
                    </td>
                    <td>
                      <Badge tone={CONF[r.confidence]?.[2]}>{t(CONF[r.confidence] || CONF.none)}</Badge>
                    </td>
                    <td className="text-xs">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {r.ranked.map((x, i) => (
                          <span key={x.carrier} className={i === 0 ? 'font-semibold text-ink' : 'text-sub'}>
                            {CARRIER_NAMES[x.carrier]} <span className="num">{x.score}</span> · {x.success}% · {x.days}
                            {t(['ي', 'j'])} · n={x.n}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Tariffs() {
  const { t, lang } = useI18n();
  const { isAll, wilayaName } = useApp();
  const { data, error, loading, reload } = useApi('/carriers/tariffs', { skip: isAll });
  const { run, busy } = useAction();
  const [edits, setEdits] = useState({});
  useEffect(() => setEdits({}), [data]);
  if (isAll) return <ErrorBox error={{ code: 'project_required' }} />;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const byW = {};
  for (const r of data) (byW[r.wilaya_code] ||= {})[r.carrier] = r;
  const codes = Object.keys(byW).map(Number).sort((a, b) => a - b);
  const key = (w, c, f) => `${w}|${c}|${f}`;
  const val = (w, c, f) => edits[key(w, c, f)] ?? byW[w]?.[c]?.[f] ?? '';
  const save = async () => {
    const list = {};
    for (const k of Object.keys(edits)) {
      const [w, c, f] = k.split('|');
      const cur = (list[`${w}|${c}`] ||= { carrier: c, wilaya_code: Number(w), home_fee: byW[w]?.[c]?.home_fee ?? null, desk_fee: byW[w]?.[c]?.desk_fee ?? null, return_fee: byW[w]?.[c]?.return_fee ?? null });
      cur[f] = edits[k] === '' ? null : Number(edits[k]);
    }
    const r = await run('save', () => api.put('/carriers/tariffs', { tariffs: Object.values(list) }));
    if (r) reload(true);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={RefreshCw} loading={busy === 'refresh'} onClick={() => run('refresh', () => api.post('/carriers/tariffs/refresh', {}), { success: t(['تم جلب الأسعار من الشركات', 'Tarifs récupérés']) }).then(() => reload(true))}>
          {t(['جلب الأسعار من الشركات', 'Récupérer les tarifs'])}
        </Button>
        {Object.keys(edits).length > 0 && (
          <Button variant="primary" icon={Save} loading={busy === 'save'} onClick={save}>
            {t(['حفظ التعديلات ({n})', 'Enregistrer ({n})'], { n: Object.keys(edits).length })}
          </Button>
        )}
        <span className="text-xs text-muted">{t(['الأسعار تُستعمل في اقتراح الشركة وحساب الربح وتكلفة المرتجعات.', 'Utilisés pour la recommandation, le profit et le coût des retours.'])}</span>
      </div>
      {codes.length ? (
        <Card pad={false}>
          <div className="max-h-[640px] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th rowSpan={2}>{t('c.wilaya')}</th>
                  {Object.keys(CARRIER_NAMES).map((c) => (
                    <th key={c} colSpan={3} className="text-center">
                      {CARRIER_NAMES[c]}
                    </th>
                  ))}
                </tr>
                <tr>
                  {Object.keys(CARRIER_NAMES).flatMap((c) => [
                    <th key={`${c}h`}>{t('c.home')}</th>,
                    <th key={`${c}d`}>{t('c.desk')}</th>,
                    <th key={`${c}r`}>{t(['إرجاع', 'Retour'])}</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {codes.map((w) => (
                  <tr key={w}>
                    <td className="whitespace-nowrap">{wilayaName(w, lang)}</td>
                    {Object.keys(CARRIER_NAMES).flatMap((c) =>
                      ['home_fee', 'desk_fee', 'return_fee'].map((f) => (
                        <td key={`${c}${f}`} className="p-1">
                          <input className="input w-20 px-2 py-1 text-xs num" inputMode="numeric" value={val(w, c, f) ?? ''} onChange={(e) => setEdits({ ...edits, [key(w, c, f)]: e.target.value })} />
                        </td>
                      )),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Empty icon={Truck} title={t(['لا أسعار بعد', 'Aucun tarif'])}>
          {t(['اضغط «جلب الأسعار» بعد ربط شركة توصيل في الإعدادات.', 'Cliquez « Récupérer les tarifs » après avoir connecté un transporteur.'])}
        </Empty>
      )}
    </div>
  );
}

function Metric({ label, value, good, bad }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-sub">{label}</span>
        <span className="num font-semibold">{pct(value)}</span>
      </div>
      <Bar value={value} tone={rateTone(value, good, bad) === 'neutral' ? 'brand' : rateTone(value, good, bad)} />
    </div>
  );
}
const Mini = ({ label, value }) => (
  <div className="rounded-lg bg-raised px-2 py-1.5">
    <div className="num font-semibold text-ink">{value}</div>
    <div className="text-[11px] text-muted">{label}</div>
  </div>
);
