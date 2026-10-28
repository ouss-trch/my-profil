import { useState } from 'react';
import { Bot, CircleDollarSign, Plus, Trash2, Wallet } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { addDays, da, dateOnly, todayDz } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, Stat, useAction } from '../components/ui.jsx';
import { BarList, BarsChart } from '../components/charts.jsx';
import FxEditor from '../components/FxEditor.jsx';

const CATS = [
  ['سلعة / مخزون', 'Marchandise / stock'],
  ['تغليف', 'Emballage'],
  ['رواتب', 'Salaires'],
  ['اشتراكات وأدوات', 'Abonnements & outils'],
  ['تصوير ومحتوى', 'Photo & contenu'],
  ['نقل', 'Transport'],
  ['أخرى', 'Autres'],
];

export default function Finance() {
  const { t, lang } = useI18n();
  const { isAll } = useApp();
  const [range, setRange] = useState('month');
  const to = todayDz();
  const from = range === 'month' ? `${to.slice(0, 8)}01` : addDays(to, -(Number(range) - 1));
  const { data, error, loading, reload } = useApi(`/finance${qs({ from, to })}`);
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const f = data?.finance;
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Wallet}
        title={t('nav.finance')}
        subtitle={`${from} → ${to}`}
        actions={
          <>
            <FxEditor onSaved={() => reload(true)} />
            <Segmented
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { value: 'month', label: t('c.thisMonth') },
                { value: '30', label: '30j' },
                { value: '90', label: '90j' },
              ]}
            />
            <Button variant="primary" icon={Plus} disabled={isAll} title={isAll ? t('c.selectProject') : undefined} onClick={() => setOpen(true)}>
              {t(['مصروف', 'Dépense'])}
            </Button>
          </>
        }
      />
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {f && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t(['الإيراد المسلّم', 'CA livré'])} value={da(f.revenue)} icon={CircleDollarSign} />
            <Stat label={t(['الإعلانات', 'Publicité'])} value={da(f.ad_spend_da)} hint={f.cost_per_delivered ? `${da(f.cost_per_delivered)} / ${t(['مسلّمة', 'livrée'])}` : null} />
            <Stat label={t(['التكاليف الأخرى', 'Autres coûts'])} value={da(f.cogs + f.shipping_cost + f.return_cost + f.expenses + (f.api_cost || 0))} />
            <Stat label={t(['صافي الربح التقديري', 'Profit net estimé'])} value={da(f.profit)} tone={f.profit < 0 ? 'bad' : 'good'} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title={t(['الإيراد مقابل الإعلانات يومياً', 'CA vs pub par jour'])} className="xl:col-span-2">
              <BarsChart
                data={data.series}
                unit="DA"
                series={[
                  { key: 'revenue', label: t(['إيراد', 'CA']) },
                  { key: 'ad_spend_da', label: t(['إعلانات', 'Pub']) },
                ]}
              />
            </Card>
            <Card title={t(['تفصيل التكاليف', 'Détail des coûts'])}>
              <BarList
                format={(v) => da(v)}
                rows={[
                  { key: 'cogs', label: t(['تكلفة المنتجات', 'Coût produits']), value: f.cogs },
                  { key: 'ads', label: t(['الإعلانات', 'Publicité']), value: f.ad_spend_da },
                  { key: 'ship', label: t(['التوصيل', 'Livraison']), value: f.shipping_cost },
                  { key: 'ret', label: t(['المرتجعات (إرجاع وتغليف)', 'Retours (frais et emballage)']), value: f.return_cost - (f.return_goods_lost || 0) },
                  { key: 'lost', label: t(['بضاعة مرتجعة تالفة أو مفقودة', 'Retours endommagés ou manquants']), value: f.return_goods_lost || 0 },
                  { key: 'exp', label: t(['مصاريف أخرى', 'Autres']), value: f.expenses },
                  { key: 'api', label: t(['الذكاء الاصطناعي والصور (API)', 'IA et images (API)']), value: f.api_cost || 0 },
                ].sort((a, b) => b.value - a.value)}
              />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t(['المصاريف المسجلة', 'Dépenses enregistrées'])} pad={false}>
              {data.expenses.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <tbody>
                      {data.expenses.map((e) => (
                        <tr key={e.id}>
                          <td className="text-xs text-muted">{dateOnly(e.date, lang)}</td>
                          <td>{e.category}</td>
                          <td className="text-xs text-sub">{e.note}</td>
                          <td className="num text-end">{da(e.amount)}</td>
                          <td>
                            <Button aria-label={t('c.delete')} size="sm" variant="ghost" icon={Trash2} onClick={() => run('del', () => api.del(`/finance/expenses/${e.id}`)).then((r) => r && reload(true))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty icon={Wallet} title={t(['لا مصاريف مسجلة', 'Aucune dépense'])} />
              )}
            </Card>
            <ApiCostCard costs={data.api_costs} />
            <Card title={t(['الربح حسب المنتج (الإيراد المسلّم)', 'CA livré par produit'])}>
              {data.products.length ? <BarList format={(v) => da(v)} rows={data.products.filter((p) => p.revenue > 0).map((p) => ({ key: p.product_id || p.title, label: p.title, value: p.revenue, extra: `${p.delivered}/${p.orders}` }))} /> : <Empty />}
            </Card>
          </div>
        </>
      )}
      <ExpenseModal open={open} onClose={(ok) => (setOpen(false), ok && reload(true))} />
    </div>
  );
}

const API_KINDS = {
  landing: ['نصوص صفحات الهبوط', 'Textes des landings'],
  landing_plan: ['أقسام الصفحات وخطة صورها', 'Sections et plan visuel des landings'],
  landing_image: ['صور صفحات الهبوط', 'Images des landings'],
  seo: ['SEO المنتجات', 'SEO produits'],
  ad_copy: ['نصوص الإعلانات', 'Textes publicitaires'],
  image: ['صور المنتجات والإعلانات', 'Images produits et pubs'],
  report: ['تقرير المستشار', 'Rapport du conseiller'],
  assistant: ['المساعد الذكي', 'Assistant IA'],
  brief: ['الملخص اليومي', 'Brief du jour'],
  test: ['اختبار الربط', 'Test de connexion'],
  other: ['أخرى', 'Autre'],
};
const PROVIDERS = { anthropic: 'Claude', gemini: 'Gemini', openai: 'OpenAI' };

/** مصاريف الواجهات المدفوعة: من الاستهلاك الفعلي لكل طلب (الرموز والصور) بالأسعار الرسمية، وبسعر الصرف في الإعدادات */
function ApiCostCard({ costs }) {
  const { t } = useI18n();
  if (!costs) return null;
  return (
    <Card
      icon={Bot}
      pad={false}
      title={t(['الذكاء الاصطناعي والصور (API)', 'IA et images (API)'])}
      subtitle={t(['كل طلب يُحسب باستهلاكه الفعلي بالأسعار الرسمية، ويدخل في المصاريف والربح. 1$ = {fx} دج (الإعدادات).', 'Chaque appel compté à sa consommation réelle aux prix officiels, inclus dans les coûts et le profit. 1 $ = {fx} DA (paramètres).'], { fx: costs.fx })}
    >
      {costs.rows.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t(['الاستعمال', 'Usage'])}</th>
                <th className="text-end">{t(['طلبات', 'Appels'])}</th>
                <th className="text-end">{t(['صور', 'Images'])}</th>
                <th className="text-end">$</th>
                <th className="text-end">{t(['دج', 'DA'])}</th>
              </tr>
            </thead>
            <tbody>
              {costs.rows.map((r) => (
                <tr key={`${r.provider}:${r.kind}:${r.model}`}>
                  <td>
                    <div className="font-medium">{t(API_KINDS[r.kind] || API_KINDS.other)}</div>
                    <div className="ltr text-[11px] text-muted">
                      {PROVIDERS[r.provider] || r.provider}
                      {r.model ? ` · ${r.model}` : ''}
                    </div>
                  </td>
                  <td className="num text-end">{r.calls}</td>
                  <td className="num text-end">{r.images || '—'}</td>
                  <td className="num text-end">{r.usd.toFixed(r.usd < 1 ? 3 : 2)}</td>
                  <td className="num whitespace-nowrap text-end">{da(r.da)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>{t(['المجموع', 'Total'])}</td>
                <td />
                <td />
                <td className="num text-end">{costs.usd.toFixed(2)}</td>
                <td className="num whitespace-nowrap text-end">{da(costs.da)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={Bot} title={t(['لا استهلاك في هذه الفترة', 'Aucune consommation sur la période'])} />
      )}
    </Card>
  );
}

function ExpenseModal({ open, onClose }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [f, setF] = useState({ date: todayDz(), category: '', amount: '', note: '' });
  return (
    <Modal
      open={open}
      onClose={() => onClose(false)}
      size="sm"
      title={t(['مصروف جديد', 'Nouvelle dépense'])}
      icon={Plus}
      footer={
        <Button variant="primary" loading={busy === 'save'} disabled={!f.category || !Number(f.amount)} onClick={() => run('save', () => api.post('/finance/expenses', { ...f, amount: Number(f.amount) })).then((r) => r && (setF({ date: todayDz(), category: '', amount: '', note: '' }), onClose(true)))}>
          {t('c.save')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label={t('c.date')}>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label={t(['الفئة', 'Catégorie'])}>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder={t('c.select')} options={CATS.map((c) => ({ value: t(c), label: t(c) }))} />
        </Field>
        <Field label={t(['المبلغ (دج)', 'Montant (DA)'])}>
          <Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label={t('c.notes')}>
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
