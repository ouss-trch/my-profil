import { useState } from 'react';
import { CircleDollarSign, Plus, Trash2, Wallet } from 'lucide-react';
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
            <Stat label={t(['التكاليف الأخرى', 'Autres coûts'])} value={da(f.cogs + f.shipping_cost + f.return_cost + f.expenses)} />
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
                  { key: 'ret', label: t(['المرتجعات', 'Retours']), value: f.return_cost },
                  { key: 'exp', label: t(['مصاريف أخرى', 'Autres']), value: f.expenses },
                ].sort((a, b) => b.value - a.value)}
              />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t(['المصاريف المسجلة', 'Dépenses enregistrées'])} pad={false}>
              {data.expenses.length ? (
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
              ) : (
                <Empty icon={Wallet} title={t(['لا مصاريف مسجلة', 'Aucune dépense'])} />
              )}
            </Card>
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
