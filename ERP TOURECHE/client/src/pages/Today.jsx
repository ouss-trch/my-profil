import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Bot, CalendarCheck, CheckCircle2, CircleDollarSign, Compass, Package, PhoneCall, ShoppingBag, Truck, Undo2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { da, dateOnly, n0, pct } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Bar, Button, Card, Empty, ErrorBox, Loading, Stat, cx, rateTone } from '../components/ui.jsx';
import { BarsChart, TrendChart } from '../components/charts.jsx';
import { InsightCard } from './Advisor.jsx';

/** «اليوم»: ما يجب فعله الآن + أرقام اليوم + اتجاه 14 يوماً */
export default function Today() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi('/dashboard/today', { interval: 60e3 });
  const advisor = useApi('/advisor');
  const reloadAdvisor = advisor.reload;
  const [brief, setBrief] = useState(null);
  const [briefBusy, setBriefBusy] = useState(false);

  useEffect(() => {
    const h = () => {
      reload(true);
      reloadAdvisor(true);
    };
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
  }, [reload, reloadAdvisor]);

  const loadBrief = async () => {
    setBriefBusy(true);
    try {
      setBrief((await api.get('/dashboard/brief')).text);
    } catch (e) {
      setBrief(e.code === 'ai_not_configured' ? t('err.ai_not_configured') : e.code);
    } finally {
      setBriefBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data;
  const pipeline = [
    { key: 'new', label: t(['جديدة', 'Nouvelles']), value: d.pipeline.new, to: '/orders?status=new', tone: 'info' },
    { key: 'no_answer', label: t(['لا يرد', 'Sans réponse']), value: d.pipeline.no_answer, to: '/orders?status=no_answer', tone: 'warn' },
    { key: 'callback', label: t(['اتصل لاحقاً', 'À rappeler']), value: d.pipeline.callback, to: '/orders?status=callback', tone: 'warn', extra: d.callbacks_due ? t(['{n} حان وقتها', '{n} à rappeler'], { n: d.callbacks_due }) : null },
    { key: 'confirmed', label: t(['للشحن', 'À expédier']), value: d.pipeline.confirmed, to: '/orders?status=confirmed', tone: 'good' },
    { key: 'shipped', label: t(['في الطريق', 'En transit']), value: d.pipeline.shipped, to: '/orders?tab=shipping', tone: 'info' },
    { key: 'at_office', label: t(['في المكتب', 'Au bureau']), value: d.pipeline.at_office, to: '/orders?status=at_office', tone: 'info' },
    { key: 'out_for_delivery', label: t(['مع الموزع', 'En livraison']), value: d.pipeline.out_for_delivery, to: '/orders?status=out_for_delivery', tone: 'purple' },
    { key: 'attempt_failed', label: t(['محاولة فاشلة', 'Échec']), value: d.pipeline.attempt_failed, to: '/orders?status=attempt_failed', tone: 'bad' },
    { key: 'returning', label: t(['في الإرجاع', 'Retour']), value: d.pipeline.returning, to: '/orders?status=returning', tone: 'bad' },
  ];
  const focus = (advisor.data?.insights || []).filter((i) => !i.hidden && ['critical', 'high'].includes(i.severity)).slice(0, 3);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CalendarCheck}
        title={t('nav.today')}
        subtitle={dateOnly(d.day, lang)}
        actions={
          <Button icon={Bot} loading={briefBusy} onClick={loadBrief}>
            {t(['ملخص ذكي لليوم', 'Brief IA du jour'])}
          </Button>
        }
      />

      {brief && (
        <Card title={t(['ملخص اليوم', 'Brief du jour'])} icon={Bot}>
          <div className="whitespace-pre-wrap text-sm leading-7 text-ink">{brief}</div>
        </Card>
      )}

      {focus.length > 0 && (
        <Card
          title={t(['أولويات الآن — من المستشار', 'Priorités maintenant — Conseiller'])}
          icon={Compass}
          actions={
            <Link to="/advisor" className="link text-xs">
              {t(['كل الملاحظات', 'Tout voir'])} ({advisor.data.counts.critical + advisor.data.counts.high})
            </Link>
          }
        >
          <div className="grid gap-3 lg:grid-cols-3">
            {focus.map((i) => (
              <InsightCard key={i.key + (i.project_id || '')} insight={i} compact onChange={() => advisor.reload(true)} />
            ))}
          </div>
        </Card>
      )}

      <Card title={t(['مسار الطلبيات الآن', 'Pipeline des commandes'])} pad={false}>
        <div className="grid grid-cols-3 divide-line sm:grid-cols-5 lg:grid-cols-9 lg:divide-x rtl:lg:divide-x-reverse">
          {pipeline.map((p) => (
            <button key={p.key} type="button" onClick={() => nav(p.to)} className="flex flex-col items-start gap-1 border-b border-line px-4 py-3 text-start transition hover:bg-raised lg:border-b-0">
              <span className="text-xs text-sub">{p.label}</span>
              <span className={cx('text-xl font-semibold num', p.value ? '' : 'text-muted')}>{n0(p.value)}</span>
              {p.extra && <Badge tone="warn">{p.extra}</Badge>}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t(['طلبيات اليوم', "Commandes aujourd'hui"])} value={n0(d.orders_today)} hint={da(d.orders_value_today)} icon={ShoppingBag} onClick={() => nav('/orders')} />
        <Stat label={t(['أُكّدت اليوم', "Confirmées aujourd'hui"])} value={n0(d.confirmed_today)} hint={`${t(['شُحنت', 'Expédiées'])}: ${n0(d.shipped_today)}`} icon={PhoneCall} />
        <Stat label={t(['سُلّمت اليوم', "Livrées aujourd'hui"])} value={n0(d.delivered_today)} hint={da(d.delivered_value_today)} icon={CheckCircle2} tone="good" />
        <Stat label={t(['أُرجعت اليوم', "Retournées aujourd'hui"])} value={n0(d.returned_today)} icon={Undo2} tone={d.returned_today ? 'bad' : undefined} />
        <Stat label={t(['إنفاق الإعلانات اليوم', "Dépense pub aujourd'hui"])} value={da(d.ad_spend_today_da)} hint={d.cpa_today_da ? `${t(['تكلفة الطلبية', 'Coût/commande'])}: ${da(d.cpa_today_da)}` : null} icon={CircleDollarSign} />
        <RateCard label={t(['نسبة التأكيد (14 يوماً)', 'Taux de confirmation (14 j)'])} value={d.confirmation_rate_14d} good={70} bad={50} />
        <RateCard label={t(['نسبة التسليم (30 يوماً)', 'Taux de livraison (30 j)'])} value={d.delivery_rate_30d} good={80} bad={65} />
        <Stat label={t(['سلات متروكة مفتوحة', 'Paniers abandonnés'])} value={n0(d.abandoned_open)} hint={`${t(['اليوم', "aujourd'hui"])}: ${n0(d.abandoned_today)}`} icon={AlertTriangle} tone="warn" onClick={() => nav('/leads')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t(['آخر 14 يوماً: الطلبيات ← التأكيد ← التسليم', '14 derniers jours : commandes → confirmées → livrées'])}>
          <TrendChart
            data={d.series}
            series={[
              { key: 'orders', label: t(['طلبيات', 'Commandes']) },
              { key: 'confirmed', label: t(['مؤكدة', 'Confirmées']) },
              { key: 'delivered', label: t(['مسلّمة', 'Livrées']) },
            ]}
          />
        </Card>
        <Card title={t(['الإيراد المسلّم مقابل إنفاق الإعلانات (دج)', 'CA livré vs dépense pub (DA)'])}>
          <BarsChart
            data={d.series}
            unit="DA"
            series={[
              { key: 'revenue', label: t(['إيراد مسلّم', 'CA livré']) },
              { key: 'ad_spend_da', label: t(['إنفاق الإعلانات', 'Dépense pub']) },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t(['الأكثر طلباً اليوم', 'Top produits du jour'])} icon={ArrowUpRight} pad={false}>
          {d.top_products.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <tbody>
                  {d.top_products.map((p) => (
                    <tr key={p.title}>
                      <td className="font-medium">{p.product_id ? <Link className="link" to={`/products/${p.product_id}`}>{p.title}</Link> : p.title}</td>
                      <td className="num text-end">{n0(p.orders)} {t(['طلبية', 'cmd'])}</td>
                      <td className="num text-end text-sub">× {n0(p.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={ShoppingBag} title={t(['لا طلبيات اليوم بعد', "Pas encore de commande aujourd'hui"])} />
          )}
        </Card>
        <Card title={t(['مخزون منخفض', 'Stock faible'])} icon={Package} pad={false}>
          {d.low_stock.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <tbody>
                  {d.low_stock.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">
                        <Link className="link" to={`/products/${p.id}`}>
                          {p.title}
                        </Link>
                      </td>
                      <td className="text-end">
                        <Badge tone={p.stock <= 0 ? 'bad' : 'warn'}>
                          {n0(p.stock)} / {n0(p.low_stock)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Truck} title={t(['المخزون جيد', 'Stock OK'])} />
          )}
        </Card>
      </div>
    </div>
  );
}

function RateCard({ label, value, good, bad }) {
  const tone = rateTone(value, good, bad);
  return (
    <div className="card card-pad flex flex-col gap-2">
      <span className="text-xs font-medium text-sub">{label}</span>
      <span className="text-2xl font-semibold">{pct(value)}</span>
      <Bar value={value} tone={tone === 'neutral' ? 'brand' : tone} />
    </div>
  );
}
