import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CircleDollarSign, LayoutDashboard, Percent, ShoppingBag, Truck, Users } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { addDays, da, n0, pct, todayDz } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Card, Empty, ErrorBox, Input, Loading, Segmented, Stat, Tabs } from '../components/ui.jsx';
import { BarList, BarsChart, TrendChart } from '../components/charts.jsx';
import { PageCell, SOURCES } from '../components/Traffic.jsx';

/** لوحة القيادة: القمع، المالية، الاتجاهات، الولايات، المنتجات، المصادر، الفريق */
export default function Dashboard() {
  const { t, lang } = useI18n();
  const { wilayaName } = useApp();
  const [range, setRange] = useState('30');
  const [custom, setCustom] = useState({ from: addDays(todayDz(), -29), to: todayDz() });
  const [tab, setTab] = useState('overview');
  const to = range === 'custom' ? custom.to : todayDz();
  const from = range === 'custom' ? custom.from : range === 'month' ? `${todayDz().slice(0, 8)}01` : addDays(todayDz(), -(Number(range) - 1));
  const { data, error, loading, reload } = useApi(`/dashboard/stats${qs({ from, to })}`);
  useEffect(() => {
    const h = () => reload(true);
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
  }, [reload]);
  const d = data;
  const wilayaRows = useMemo(() => (d?.wilayas || []).slice(0, 15).map((w) => ({ key: w.wilaya_code, label: wilayaName(w.wilaya_code, lang), value: w.orders, extra: w.delivery_rate !== null ? `${t(['تسليم', 'livr.'])} ${w.delivery_rate}%` : '' })), [d, lang, t, wilayaName]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LayoutDashboard}
        title={t('nav.dashboard')}
        subtitle={`${from} → ${to}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={range}
              onChange={setRange}
              size="sm"
              options={[
                { value: '7', label: t(['7 أيام', '7 j']) },
                { value: '30', label: t(['30 يوماً', '30 j']) },
                { value: '90', label: t(['90 يوماً', '90 j']) },
                { value: 'month', label: t('c.thisMonth') },
                { value: 'custom', label: t(['مخصص', 'Perso.']) },
              ]}
            />
            {range === 'custom' && (
              <>
                <Input type="date" className="w-auto py-1.5" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
                <Input type="date" className="w-auto py-1.5" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </>
            )}
          </div>
        }
      />
      {loading && !d ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('c.orders')} value={n0(d.funnel.orders)} hint={`${t(['مؤكدة', 'Confirmées'])}: ${n0(d.funnel.confirmed)}`} icon={ShoppingBag} />
            <Stat label={t(['نسبة التأكيد', 'Taux de confirmation'])} value={pct(d.confirmation_rate)} icon={Percent} />
            <Stat label={t(['نسبة التسليم', 'Taux de livraison'])} value={pct(d.delivery_rate)} hint={`${n0(d.funnel.delivered)} / ${n0(d.funnel.returned)}`} icon={Truck} />
            <Stat label={t(['الربح التقديري', 'Profit estimé'])} value={da(d.finance.profit)} hint={`${t(['الإيراد', 'CA'])}: ${da(d.finance.revenue)}`} icon={CircleDollarSign} tone={d.finance.profit < 0 ? 'bad' : 'good'} />
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: t(['نظرة عامة', "Vue d'ensemble"]), icon: BarChart3 },
              { value: 'wilayas', label: t(['الولايات', 'Wilayas']) },
              { value: 'products', label: t('c.products') },
              { value: 'sources', label: t(['المصادر', 'Sources']) },
              { value: 'agents', label: t(['الفريق', 'Équipe']), icon: Users },
            ]}
          />
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-3">
                <Card title={t(['القمع', 'Entonnoir'])}>
                  <Funnel f={d.funnel} />
                </Card>
                <Card title={t(['المالية التقديرية', 'Finance estimée'])} className="xl:col-span-2">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <Row label={t(['الإيراد المسلّم', 'CA livré'])} value={da(d.finance.revenue)} strong />
                    <Row label={t(['تكلفة المنتجات', 'Coût produits'])} value={da(-(d.finance.cogs || 0))} />
                    <Row label={t(['تكلفة التوصيل', 'Livraison'])} value={da(-(d.finance.shipping_cost || 0))} />
                    <Row label={t(['تكلفة المرتجعات', 'Retours'])} value={da(-(d.finance.return_cost || 0))} />
                    <Row label={t(['الإعلانات', 'Publicité'])} value={da(-(d.finance.ad_spend_da || 0))} />
                    <Row label={t(['مصاريف أخرى', 'Autres charges'])} value={da(-(d.finance.expenses || 0))} />
                    <Row label={t(['الذكاء الاصطناعي (API)', 'IA (API)'])} value={da(-(d.finance.api_cost || 0))} />
                    <Row label={t(['الربح', 'Profit'])} value={da(d.finance.profit)} strong tone={d.finance.profit < 0 ? 'text-bad' : 'text-good'} />
                    <Row label={t(['تكلفة الطلبية', 'Coût / commande'])} value={da(d.finance.cpa)} />
                    <Row label={t(['تكلفة المسلّمة', 'Coût / livrée'])} value={da(d.finance.cost_per_delivered)} />
                  </dl>
                  <p className="mt-3 text-xs text-muted">{t(['الإيراد = الطلبيات المسلّمة فقط. الإعلانات محوّلة بسعر الصرف في الإعدادات.', 'CA = commandes livrées uniquement. Pub convertie au taux défini dans les paramètres.'])}</p>
                </Card>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={t(['الطلبيات يومياً', 'Commandes par jour'])}>
                  <TrendChart
                    data={d.series}
                    series={[
                      { key: 'orders', label: t(['طلبيات', 'Commandes']) },
                      { key: 'confirmed', label: t(['مؤكدة', 'Confirmées']) },
                      { key: 'delivered', label: t(['مسلّمة', 'Livrées']) },
                      { key: 'returned', label: t(['مرتجعة', 'Retours']) },
                    ]}
                  />
                </Card>
                <Card title={t(['الإيراد المسلّم مقابل الإعلانات (دج)', 'CA livré vs pub (DA)'])}>
                  <BarsChart
                    data={d.series}
                    unit="DA"
                    series={[
                      { key: 'revenue', label: t(['إيراد', 'CA']) },
                      { key: 'ad_spend_da', label: t(['إعلانات', 'Pub']) },
                    ]}
                  />
                </Card>
              </div>
            </div>
          )}
          {tab === 'wilayas' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t(['أكثر الولايات طلباً', 'Wilayas les plus actives'])}>{wilayaRows.length ? <BarList rows={wilayaRows} /> : <Empty />}</Card>
              <Card title={t(['التفاصيل', 'Détails'])} pad={false}>
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('c.wilaya')}</th>
                        <th className="text-end">{t('c.orders')}</th>
                        <th className="text-end">{t(['مؤكدة', 'Conf.'])}</th>
                        <th className="text-end">{t(['مسلّمة', 'Livr.'])}</th>
                        <th className="text-end">{t(['مرتجعة', 'Ret.'])}</th>
                        <th className="text-end">{t(['التسليم', 'Taux'])}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.wilayas.map((w) => (
                        <tr key={w.wilaya_code}>
                          <td>{wilayaName(w.wilaya_code, lang)}</td>
                          <td className="num text-end">{w.orders}</td>
                          <td className="num text-end">{w.confirmed}</td>
                          <td className="num text-end">{w.delivered}</td>
                          <td className="num text-end">{w.returned}</td>
                          <td className={`num text-end ${w.delivery_rate !== null && w.delivery_rate < 60 ? 'text-bad' : ''}`}>{pct(w.delivery_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
          {tab === 'products' && (
            <Card pad={false}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('c.product')}</th>
                    <th className="text-end">{t('c.orders')}</th>
                    <th className="text-end">{t(['الكمية', 'Qté'])}</th>
                    <th className="text-end">{t(['مؤكدة', 'Conf.'])}</th>
                    <th className="text-end">{t(['مسلّمة', 'Livr.'])}</th>
                    <th className="text-end">{t(['مرتجعة', 'Ret.'])}</th>
                    <th className="text-end">{t(['الإيراد', 'CA'])}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.products.map((p) => (
                    <tr key={p.product_id || p.title}>
                      <td className="font-medium">{p.title}</td>
                      <td className="num text-end">{p.orders}</td>
                      <td className="num text-end">{p.qty}</td>
                      <td className="num text-end">{p.confirmed}</td>
                      <td className="num text-end">{p.delivered}</td>
                      <td className="num text-end">{p.returned}</td>
                      <td className="num text-end">{da(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.products.length && <Empty />}
            </Card>
          )}
          {tab === 'sources' && (
            <div className="space-y-4">
              <Card
                pad={false}
                title={t(['الطلبيات حسب الصفحة', 'Commandes par page'])}
                subtitle={t(['الصفحة التي أُرسل منها النموذج (صفحة هبوط، صفحة منتج…)، وزوارها في نفس الفترة من العدّاد المخفي. المزيفة لا تُحسب.', 'La page d’où le formulaire est parti (landing, fiche produit…), avec ses visiteurs sur la même période (compteur invisible). Hors fausses commandes.'])}
              >
                {d.source_pages?.length ? (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t(['الصفحة', 'Page'])}</th>
                          <th className="text-end">{t(['زوار', 'Visiteurs'])}</th>
                          <th className="text-end">{t('c.orders')}</th>
                          <th className="text-end">{t(['التحويل', 'Conversion'])}</th>
                          <th className="text-end">{t(['مؤكدة', 'Confirmées'])}</th>
                          <th className="text-end">{t(['مسلّمة', 'Livrées'])}</th>
                          <th className="text-end">{t(['الإيراد', 'CA'])}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.source_pages.map((p) => (
                          <tr key={`${p.project_id}:${p.key}`}>
                            <td className="min-w-[13rem]">
                              <PageCell p={p} />
                            </td>
                            <td className="num text-end">{p.key ? n0(p.visitors) : '—'}</td>
                            <td className="num text-end font-semibold">{n0(p.orders)}</td>
                            <td className="num text-end">{pct(p.conversion, 2)}</td>
                            <td className="num text-end">{n0(p.confirmed)}</td>
                            <td className="num text-end">
                              {n0(p.delivered)}
                              {p.delivery_rate !== null && <span className="text-xs text-muted"> · {pct(p.delivery_rate)}</span>}
                            </td>
                            <td className="num text-end">{da(p.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty />
                )}
              </Card>
              <Card title={t(['حسب القناة', 'Par canal'])} subtitle={t(['آخر مصدر قبل الطلب: معاملات رابط الصفحة (fbclid، utm_source…). الحكم بالمسلّمة لا بالطلبيات.', 'Dernière source avant la commande (fbclid, utm_source… du lien). Jugez sur les livrées, pas sur les commandes.'])}>
                {d.sources.length ? (
                  <BarList
                    rows={d.sources.map((s) => ({
                      key: s.source,
                      label: t(SOURCES[s.source] || [s.source, s.source]),
                      value: s.orders,
                      extra: `${t(['مسلّمة', 'livrées'])} ${s.delivered}${s.delivery_rate !== null ? ` · ${pct(s.delivery_rate)}` : ''}`,
                    }))}
                  />
                ) : (
                  <Empty />
                )}
              </Card>
            </div>
          )}
          {tab === 'agents' && (
            <Card pad={false}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t(['الموظف', 'Agent'])}</th>
                    <th className="text-end">{t(['مؤكدة', 'Confirmées'])}</th>
                    <th className="text-end">{t(['ملغاة', 'Annulées'])}</th>
                    <th className="text-end">{t(['لا يرد', 'Sans rép.'])}</th>
                    <th className="text-end">{t(['النسبة', 'Taux'])}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.agents.map((a) => (
                    <tr key={a.id}>
                      <td>{a.display_name || a.username}</td>
                      <td className="num text-end">{a.confirmed}</td>
                      <td className="num text-end">{a.cancelled}</td>
                      <td className="num text-end">{a.no_answer}</td>
                      <td className="num text-end">{a.confirmed + a.cancelled ? pct((100 * a.confirmed) / (a.confirmed + a.cancelled)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.agents.length && <Empty title={t(['لا نشاط تأكيد مسجّل باسم موظف في هذه الفترة', 'Aucune confirmation enregistrée par un agent'])} />}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5">
      <dt className="text-sub">{label}</dt>
      <dd className={`num ${strong ? 'font-semibold' : ''} ${tone || ''}`}>{value}</dd>
    </div>
  );
}

function Funnel({ f }) {
  const { t } = useI18n();
  const steps = [
    { k: 'orders', label: t(['طلبيات', 'Commandes']), v: f.orders },
    { k: 'confirmed', label: t(['مؤكدة', 'Confirmées']), v: f.confirmed },
    { k: 'shipped', label: t(['شُحنت', 'Expédiées']), v: f.shipped },
    { k: 'delivered', label: t(['سُلّمت', 'Livrées']), v: f.delivered },
  ];
  const top = Math.max(1, f.orders);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.k}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-ink">{s.label}</span>
            <span className="num text-sub">
              {n0(s.v)} {i > 0 && steps[i - 1].v ? <span className="text-muted">({Math.round((100 * s.v) / steps[i - 1].v)}%)</span> : null}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-line/60">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(100 * s.v) / top}%`, opacity: 1 - i * 0.15 }} />
          </div>
        </li>
      ))}
      <li className="pt-1 text-xs text-muted">
        {t(['ملغاة', 'Annulées'])}: {n0(f.cancelled)} · {t(['تنتظر', 'En attente'])}: {n0(f.pending)} · {t(['في التوصيل', 'En livraison'])}: {n0(f.in_delivery)}
      </li>
    </ol>
  );
}
