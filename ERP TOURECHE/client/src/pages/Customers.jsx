import { useState } from 'react';
import { Ban, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { ago, da, n0 } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { StatusBadge } from '../components/status.jsx';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Input, Loading, Segmented, Stat, useAction } from '../components/ui.jsx';
import { OrderDrawer } from './Orders.jsx';

const RISK_TONE = { high: 'bad', medium: 'warn', low: 'good' };

export default function Customers() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [risk, setRisk] = useState('');
  const [phone, setPhone] = useState(null);
  const { data, error, loading, reload } = useApi(`/customers${qs({ q: dq, risk, limit: 300 })}`);
  const rows = data || [];
  const repeat = rows.filter((r) => r.delivered >= 2).length;
  return (
    <div className="space-y-4">
      <PageHeader icon={Users} title={t('nav.customers')} subtitle={t(['تاريخ كل زبون، المخاطر، والقائمة السوداء — يُحسب من كل الطلبيات', 'Historique, risque et liste noire — calculés sur toutes les commandes'])} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t(['زبائن (المعروضون)', 'Clients (affichés)'])} value={n0(rows.length)} icon={Users} />
        <Stat label={t(['اشتروا مرتين أو أكثر', 'Ont racheté'])} value={n0(repeat)} tone="good" />
        <Stat label={t(['خطر مرتفع', 'Risque élevé'])} value={n0(rows.filter((r) => r.risk === 'high').length)} tone="bad" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(['اسم أو هاتف…', 'Nom ou téléphone…'])} />
        <Segmented
          value={risk}
          onChange={setRisk}
          options={[
            { value: '', label: t('c.all') },
            { value: 'high', label: t(['خطر مرتفع', 'Risque élevé']) },
            { value: 'medium', label: t(['متوسط', 'Moyen']) },
            { value: 'low', label: t(['موثوق', 'Fiable']) },
          ]}
        />
      </div>
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t(['الزبون', 'Client'])}</th>
                  <th>{t('c.wilaya')}</th>
                  <th className="text-end">{t('c.orders')}</th>
                  <th className="text-end">{t(['مسلّمة', 'Livrées'])}</th>
                  <th className="text-end">{t(['مرتجعة', 'Retours'])}</th>
                  <th className="text-end">{t(['الإيراد', 'CA'])}</th>
                  <th>{t(['آخر طلبية', 'Dernière'])}</th>
                  <th>{t(['الخطر', 'Risque'])}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.phone}>
                    <td>
                      <button type="button" className="link font-medium" onClick={() => setPhone(c.phone)}>
                        {c.name || '—'}
                      </button>
                      <div className="ltr text-xs text-muted">{c.phone}</div>
                    </td>
                    <td className="text-xs">{c.wilaya ? (lang === 'ar' ? c.wilaya.ar : c.wilaya.fr) : '—'}</td>
                    <td className="num text-end">{c.orders}</td>
                    <td className="num text-end">{c.delivered}</td>
                    <td className="num text-end">{c.returned}</td>
                    <td className="num text-end">{da(c.revenue)}</td>
                    <td className="text-xs text-muted">{ago(c.last_order, lang)}</td>
                    <td>
                      <Badge tone={RISK_TONE[c.risk]}>{c.blacklisted ? t(['محظور', 'Liste noire']) : c.risk}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Users} />
        )}
      </Card>
      <CustomerDrawer phone={phone} onClose={() => setPhone(null)} onChanged={() => reload(true)} />
    </div>
  );
}

function CustomerDrawer({ phone, onClose, onChanged }) {
  const { t, lang } = useI18n();
  const { data, reload } = useApi(phone ? `/customers/${encodeURIComponent(phone)}` : null, { skip: !phone });
  const { run, busy } = useAction();
  const [reason, setReason] = useState('');
  const [orderId, setOrderId] = useState(null);
  if (!phone) return null;
  const flag = async (blacklisted) => {
    const r = await run('flag', () => api.put(`/customers/${encodeURIComponent(phone)}/flag`, { blacklisted, reason }));
    if (r) {
      reload(true);
      onChanged();
    }
  };
  return (
    <Drawer open onClose={onClose} title={<span className="ltr">{phone}</span>}>
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('c.orders')} value={data.orders.length} />
            <Stat label={t(['مسلّمة', 'Livrées'])} value={data.delivered} tone="good" />
            <Stat label={t(['مرتجعة', 'Retours'])} value={data.returned} tone="bad" />
            <Stat label={t(['ملغاة', 'Annulées'])} value={data.cancelled} />
          </div>
          <Card title={t(['القائمة السوداء', 'Liste noire'])}>
            {data.blacklisted ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge tone="bad" icon={Ban}>
                  {t(['محظور', 'Bloqué'])}
                </Badge>
                <span className="text-sub">{data.flag_reason}</span>
                <Button size="sm" icon={ShieldCheck} loading={busy === 'flag'} onClick={() => flag(false)}>
                  {t(['رفع الحظر', 'Débloquer'])}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(['السبب (رفض الاستلام مرتين…)', 'Motif (2 refus…)'])} />
                <Button variant="danger" icon={Ban} loading={busy === 'flag'} onClick={() => flag(true)}>
                  {t(['حظر الرقم', 'Bloquer le numéro'])}
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">{t(['الطلبيات الجديدة من رقم محظور تُوسم تلقائياً للتنبيه.', 'Les nouvelles commandes d’un numéro bloqué sont marquées automatiquement.'])}</p>
          </Card>
          <Card title={t('c.orders')} pad={false}>
            <table className="table">
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button type="button" className="link" onClick={() => setOrderId(o.id)}>
                        {o.shopify_name || o.ref}
                      </button>
                      <div className="text-xs text-muted">{ago(o.created_at, lang)}</div>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="num text-end">{da(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      <OrderDrawer id={orderId} onClose={() => setOrderId(null)} onChanged={() => reload(true)} />
    </Drawer>
  );
}
