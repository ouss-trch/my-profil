import { useEffect, useState } from 'react';
import { Ban, PhoneOff, ShieldCheck, Truck, Users } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { ago, da, n0 } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { StatusBadge } from '../components/status.jsx';
import { Advice, CallLessons, LEVEL_KEYS, LEVELS, ReasonChips, RiskBadge, pTone } from '../components/CustomerRisk.jsx';
import { Button, Card, Drawer, Empty, ErrorBox, Input, Loading, Pagination, Select, Stat, cx, useAction } from '../components/ui.jsx';
import { OrderDrawer } from './Orders.jsx';
import BulkDelete from '../components/BulkDelete.jsx';
import { useApp } from '../components/ProjectContext.jsx';

const LIMIT = 100;

export default function Customers() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [risk, setRisk] = useState('');
  const [sort, setSort] = useState('recent');
  const [offset, setOffset] = useState(0);
  const [phone, setPhone] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const { auth, isAll } = useApp();
  const admin = auth.user?.role === 'admin';
  const path = `/customers${qs({ q: dq, risk, sort, limit: LIMIT, offset })}`;
  const { data, error, loading, reload } = useApi(path);
  useEffect(() => setSelected(new Set()), [path]);
  const rows = data?.rows || [];
  const counts = data?.counts || {};
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.phone));
  const picked = rows.filter((r) => selected.has(r.phone));
  const pickedOrders = picked.reduce((s, r) => s + r.orders + r.abandoned, 0);
  const toggle = (p) => {
    const s = new Set(selected);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    setSelected(s);
  };
  const filter = (level) => {
    setRisk(risk === level ? '' : level);
    setOffset(0);
  };
  return (
    <div className="space-y-4">
      <PageHeader icon={Users} title={t('nav.customers')} subtitle={t(['تقييم كل زبون: احتمال التسليم من تاريخه، ومن «لا يرد» عند التأكيد، ومن محاولات التوصيل الفاشلة', 'Chaque client évalué : livraison attendue selon son historique, ses appels sans réponse et les échecs de livraison'])} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 grid lg:col-span-1">
          <Stat label={t(['كل الزبائن', 'Tous les clients'])} value={n0(data?.all ?? 0)} icon={Users} onClick={() => filter('')} />
        </div>
        <Stat label={t(['اشتروا مرتين أو أكثر', 'Ont racheté'])} value={n0(data?.repeat ?? 0)} tone="good" />
        <Stat label={t(['موثوقون', 'Fiables'])} value={n0(counts.trusted ?? 0)} tone="good" icon={ShieldCheck} onClick={() => filter('trusted')} />
        <Stat label={t(['متوسط', 'Moyens'])} value={n0(counts.medium ?? 0)} tone="warn" icon={PhoneOff} onClick={() => filter('medium')} />
        <Stat label={t(['خطر', 'Risqués'])} value={n0(counts.high ?? 0)} tone="bad" icon={Ban} onClick={() => filter('high')} />
      </div>
      <CallLessons lessons={data?.lessons} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-0 flex-1 sm:max-w-xs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          placeholder={t(['اسم أو هاتف…', 'Nom ou téléphone…'])}
        />
        <Select
          className="w-auto"
          aria-label={t(['التقييم', 'Évaluation'])}
          value={risk}
          onChange={(e) => filter(e.target.value)}
          options={[{ value: '', label: t(['كل التقييمات', 'Toutes les évaluations']) }, ...LEVEL_KEYS.map((k) => ({ value: k, label: `${t(LEVELS[k].label)} (${n0(counts[k] ?? 0)})` }))]}
        />
        <Select
          className="w-auto"
          aria-label={t(['الترتيب', 'Tri'])}
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setOffset(0);
          }}
          options={[
            { value: 'recent', label: t(['الأحدث', 'Plus récents']) },
            { value: 'risk', label: t(['الأخطر أولاً', 'Plus risqués d’abord']) },
            { value: 'value', label: t(['الأعلى قيمة', 'Plus gros CA']) },
          ]}
        />
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand/5 px-3 py-1.5 text-sm">
          <span className="font-medium">{t(['{n} محددون · {o} طلبية', '{n} sélectionnés · {o} commandes'], { n: selected.size, o: pickedOrders })}</span>
          <BulkDelete
            count={selected.size}
            all={allSel}
            label={t(['حذف {n} زبون', 'Supprimer {n} client(s)'], { n: selected.size })}
            allLabel={t(['ستحذف كل الزبائن المعروضين', 'Vous allez supprimer tous les clients affichés'])}
            points={[
              isAll
                ? t(['تُحذف كل طلبياتهم في كل المشاريع: {o} طلبية مع سجلها.', 'Toutes leurs commandes, dans tous les projets, sont supprimées : {o} commandes avec leur historique.'], { o: pickedOrders })
                : t(['تُحذف كل طلبياتهم في هذا المشروع: {o} طلبية مع سجلها.', 'Toutes leurs commandes de ce projet sont supprimées : {o} commandes avec leur historique.'], { o: pickedOrders }),
              t(['القائمة السوداء تبقى: إن عاد رقم محظور يُنبَّه عليه.', 'La liste noire est conservée : un numéro bloqué qui revient reste signalé.']),
              t(['في Shopify تبقى الطلبيات كما هي، ولن تعيدها المزامنة.', 'Dans Shopify les commandes restent intactes, et la synchro ne les fera pas revenir.']),
            ]}
            run={() => api.post('/customers/bulk/delete', { phones: [...selected] }, { reason: t(['أدخل كلمة المرور الحساسة لحذف {n} زبون', 'Mot de passe sensible pour supprimer {n} client(s)'], { n: selected.size }) })}
            done={(r) => t(['حُذف {n} زبون ({o} طلبية)', '{n} client(s) supprimé(s) ({o} commandes)'], { n: r.customers, o: r.deleted })}
            onDone={() => {
              setSelected(new Set());
              reload(true);
            }}
          />
        </div>
      )}
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : rows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    {admin && (
                      <th className="w-8">
                        <input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.phone)))} aria-label={t(['تحديد الكل', 'Tout sélectionner'])} />
                      </th>
                    )}
                    <th>{t(['الزبون', 'Client'])}</th>
                    <th>{t(['التقييم', 'Évaluation'])}</th>
                    <th className="text-end" title={t(['احتمال أن يستلم طلبيته القادمة', 'Probabilité qu’il reçoive sa prochaine commande'])}>
                      {t(['احتمال التسليم', 'Livraison attendue'])}
                    </th>
                    <th className="text-end">{t('c.orders')}</th>
                    <th className="text-end">{t(['مسلّمة', 'Livrées'])}</th>
                    <th className="text-end">{t(['مرتجعة', 'Retours'])}</th>
                    <th className="text-end" title={t(['مرات «لا يرد» عند التأكيد، في كل طلبياته', 'Appels sans réponse à la confirmation, toutes commandes'])}>
                      {t(['لا يرد', 'Sans réponse'])}
                    </th>
                    <th className="text-end" title={t(['محاولات توصيل فاشلة، أو كتب الموزع أنه لا يرد/هاتفه مغلق', 'Échecs de livraison, ou livreur : injoignable / téléphone éteint'])}>
                      {t(['فشل التوصيل', 'Échecs livr.'])}
                    </th>
                    <th className="text-end">{t(['الإيراد', 'CA'])}</th>
                    <th>{t('c.wilaya')}</th>
                    <th>{t(['آخر طلبية', 'Dernière'])}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const fails = Math.max(c.delivery_failed, c.carrier_unreachable);
                    return (
                      <tr key={c.phone} className={selected.has(c.phone) ? 'bg-brand/5' : undefined}>
                        {admin && (
                          <td>
                            <input type="checkbox" checked={selected.has(c.phone)} onChange={() => toggle(c.phone)} aria-label={c.name || c.phone} />
                          </td>
                        )}
                        <td>
                          <button type="button" className="link font-medium" onClick={() => setPhone(c.phone)}>
                            {c.name || '—'}
                          </button>
                          <div className="ltr text-xs text-muted">{c.phone}</div>
                        </td>
                        <td className="min-w-[9rem]">
                          <RiskBadge level={c.level} blacklisted={c.blacklisted} />
                          <ReasonChips reasons={c.reasons.filter((r) => !r.good).slice(0, 2)} className="mt-1" />
                        </td>
                        <td className={cx('num text-end font-semibold', pTone(c.level))}>{c.p_deliver}%</td>
                        <td className="num text-end">{c.orders}</td>
                        <td className="num text-end">{c.delivered}</td>
                        <td className={cx('num text-end', c.returned > 0 && 'font-semibold text-bad')}>{c.returned}</td>
                        <td className={cx('num text-end', c.no_answer_calls >= 2 && 'font-semibold text-warn')}>{c.no_answer_calls}</td>
                        <td className={cx('num text-end', fails > 0 && 'font-semibold text-warn')}>{fails}</td>
                        <td className="num text-end">{da(c.revenue)}</td>
                        <td className="whitespace-nowrap text-xs">{c.wilaya ? (lang === 'ar' ? c.wilaya.ar : c.wilaya.fr) : '—'}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{ago(c.last_order, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
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
          <div className={cx('space-y-2 rounded-lg border px-3 py-3', LEVELS[data.level]?.box)}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <RiskBadge level={data.level} blacklisted={data.blacklisted} />
              <span className="text-sub">
                {t(['احتمال التسليم المتوقع', 'Livraison attendue'])}: <b className={cx('num', pTone(data.level))}>{data.p_deliver}%</b>
              </span>
            </div>
            <ReasonChips reasons={data.reasons} />
            <Advice code={data.advice} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('c.orders')} value={data.orders.length} />
            <Stat label={t(['مسلّمة', 'Livrées'])} value={data.delivered} tone="good" />
            <Stat label={t(['مرتجعة', 'Retours'])} value={data.returned} tone="bad" />
            <Stat label={t(['ملغاة', 'Annulées'])} value={data.cancelled} />
            <Stat label={t(['«لا يرد» عند التأكيد', 'Sans réponse (confirmation)'])} value={data.no_answer_calls} icon={PhoneOff} tone={data.no_answer_calls >= 2 ? 'warn' : undefined} />
            <Stat label={t(['محاولات توصيل فاشلة', 'Échecs de livraison'])} value={data.delivery_failed} icon={Truck} tone={data.delivery_failed ? 'warn' : undefined} />
            <Stat label={t(['لم يرد على الموزع', 'Injoignable (livreur)'])} value={data.carrier_unreachable} tone={data.carrier_unreachable ? 'warn' : undefined} />
            <Stat label={t(['رفض الاستلام', 'Refus'])} value={data.refused} tone={data.refused ? 'bad' : undefined} />
          </div>
          <Card title={t(['القائمة السوداء', 'Liste noire'])}>
            {data.blacklisted ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <RiskBadge level="high" blacklisted />
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
            <div className="overflow-x-auto">
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
            </div>
          </Card>
        </div>
      )}
      <OrderDrawer id={orderId} onClose={() => setOrderId(null)} onChanged={() => reload(true)} />
    </Drawer>
  );
}
