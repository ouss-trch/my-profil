import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  Send,
  ShoppingBag,
  Star,
  Trash2,
  Truck,
  User,
  XCircle,
} from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { api, getApiProject, qs } from '../lib/api.js';
import { ago, da, dateTime, n0, waLink } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { CARRIER_NAMES, StatusBadge, useStatusLabel } from '../components/status.jsx';
import { DeliveryContacts } from './Contacts.jsx';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, Loading, Modal, Pagination, Select, Tabs, Textarea, Toggle, cx, useAction, useToast } from '../components/ui.jsx';

export const TABS = {
  confirm: ['new', 'no_answer', 'callback'],
  to_ship: ['confirmed'],
  shipping: ['shipped', 'in_transit', 'at_office', 'out_for_delivery', 'attempt_failed', 'returning'],
  delivered: ['delivered'],
  returned: ['returned'],
  closed: ['cancelled', 'fake'],
  all: ['new', 'no_answer', 'callback', 'confirmed', 'shipped', 'in_transit', 'at_office', 'out_for_delivery', 'attempt_failed', 'returning', 'delivered', 'returned', 'cancelled', 'fake'],
};
const CANCEL_REASONS = [
  ['السعر مرتفع', 'Prix trop élevé'],
  ['طلب بالخطأ', 'Commande par erreur'],
  ['غيّر رأيه', "A changé d'avis"],
  ['رقم خاطئ', 'Mauvais numéro'],
  ['طلبية مكررة', 'Doublon'],
  ['التوصيل غالٍ', 'Livraison trop chère'],
];


export function itemsText(items) {
  return (items || []).map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} × ${i.qty}`).join('، ');
}

export default function Orders() {
  const { t, lang } = useI18n();
  const { wilayaName, meta, isAll } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (params.get('status') ? null : 'confirm');
  const status = params.get('status');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [wilaya, setWilaya] = useState(params.get('wilaya') || '');
  const [carrier, setCarrier] = useState(params.get('carrier') || '');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [openId, setOpenId] = useState(params.get('open') ? Number(params.get('open')) : null);
  const [newOpen, setNewOpen] = useState(false);
  const [bulkShip, setBulkShip] = useState(false);
  const { run, busy } = useAction();
  const limit = 50;

  const statuses = status ? [status] : TABS[tab] || TABS.confirm;
  const path = `/orders${qs({ statuses: statuses.join(','), q: dq, wilaya, carrier, limit, offset, sort: tab === 'confirm' ? 'oldest' : 'newest' })}`;
  const { data, error, loading, reload } = useApi(path);
  const counts = useApi('/orders/counts');
  useEffect(() => setOffset(0), [dq, wilaya, carrier, tab, status]);
  useEffect(() => setSelected(new Set()), [path]);
  useEffect(() => {
    const h = () => {
      reload(true);
      counts.reload(true);
    };
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const countOf = (keys) => keys.reduce((s, k) => s + (counts.data?.[k] || 0), 0);
  const refreshAll = () => {
    reload(true);
    counts.reload(true);
  };
  const setTab = (v) => setParams({ tab: v });
  const rows = data?.rows || [];
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const quick = async (o, to, extra = {}) => {
    const r = await run(`${o.id}:${to}`, () => api.post(`/orders/${o.id}/status`, { status: to, ...extra }), { success: false });
    if (r) refreshAll();
  };
  const bulkStatus = async (to) => {
    const r = await run('bulk', () => api.post('/orders/bulk/status', { ids: [...selected], status: to }), { success: false });
    if (r) {
      const ok = r.results.filter((x) => x.ok).length;
      notifyBulk(ok, r.results.length - ok);
      setSelected(new Set());
      refreshAll();
    }
  };
  const toast = useToast();
  const notifyBulk = (ok, fail) => (fail ? toast.error(t(['نجح {ok} وفشل {fail}', '{ok} OK, {fail} en échec'], { ok, fail })) : toast.ok(t(['تم تحديث {ok} طلبية', '{ok} commandes mises à jour'], { ok })));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShoppingBag}
        title={t('nav.orders')}
        subtitle={t(['من الطلبية إلى التسليم: التأكيد، الشحن، التتبع', 'De la commande à la livraison : confirmation, expédition, suivi'])}
        actions={
          <>
            <a className="btn" href={`/api/orders/export.csv${qs({ statuses: statuses.join(','), q: dq, wilaya, carrier, project: getApiProject() })}`}>
              <Download className="h-4 w-4" />
              {t('c.exportCsv')}
            </a>
            <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)} disabled={isAll} title={isAll ? t('c.selectProject') : undefined}>
              {t(['طلبية يدوية', 'Commande manuelle'])}
            </Button>
          </>
        }
      />
      <Tabs
        value={status ? '' : tab}
        onChange={setTab}
        tabs={[
          { value: 'confirm', label: t(['للتأكيد', 'À confirmer']), count: countOf(TABS.confirm) },
          { value: 'to_ship', label: t(['للشحن', 'À expédier']), count: countOf(TABS.to_ship) },
          { value: 'shipping', label: t(['في التوصيل', 'En livraison']), count: countOf(TABS.shipping) },
          { value: 'delivered', label: t(['مسلّمة', 'Livrées']), count: countOf(TABS.delivered) },
          { value: 'returned', label: t(['مرتجعة', 'Retournées']), count: countOf(TABS.returned) },
          { value: 'closed', label: t(['ملغاة', 'Annulées']), count: countOf(TABS.closed) },
          { value: 'all', label: t('c.all') },
        ]}
      />
      {status && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-sub">{t('c.status')}:</span>
          <StatusBadge status={status} />
          <Button size="sm" variant="ghost" onClick={() => setParams({ tab: 'all' })}>
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(['اسم، هاتف، رقم الطلبية، التتبع…', 'Nom, téléphone, n°, suivi…'])} />
        <Select className="w-auto" value={wilaya} onChange={(e) => setWilaya(e.target.value)} placeholder={t('c.wilaya')} options={(meta?.wilayas || []).map((w) => ({ value: w.code, label: wilayaName(w.code, lang) }))} />
        <Select className="w-auto" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t('c.carrier')} options={Object.entries(CARRIER_NAMES).map(([k, v]) => ({ value: k, label: v }))} />
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand/5 px-3 py-1.5 text-sm">
            <span className="font-medium">{t(['{n} محددة', '{n} sélectionnées'], { n: selected.size })}</span>
            {statuses.some((s) => TABS.confirm.includes(s)) && (
              <>
                <Button size="sm" icon={CheckCircle2} loading={busy === 'bulk'} onClick={() => bulkStatus('confirmed')}>
                  {t(['تأكيد', 'Confirmer'])}
                </Button>
                <Button size="sm" icon={PhoneOff} onClick={() => bulkStatus('no_answer')}>
                  {t(['لا يرد', 'Sans réponse'])}
                </Button>
              </>
            )}
            {statuses.includes('confirmed') && (
              <Button size="sm" variant="primary" icon={Truck} onClick={() => setBulkShip(true)}>
                {t(['إرسال لشركة التوصيل', 'Envoyer au transporteur'])}
              </Button>
            )}
          </div>
        )}
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
                  <th className="w-8">
                    <input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="select all" />
                  </th>
                  <th>{t(['الطلبية', 'Commande'])}</th>
                  <th>{t(['الزبون', 'Client'])}</th>
                  <th>{t('c.wilaya')}</th>
                  <th>{t('c.products')}</th>
                  <th className="text-end">{t('c.total')}</th>
                  <th>{t('c.status')}</th>
                  <th>{t('c.carrier')}</th>
                  {statuses.some((s) => TABS.confirm.includes(s)) && <th>{t(['تأكيد سريع', 'Action rapide'])}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={cx(selected.has(o.id) && 'bg-brand/5')}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => {
                          const s = new Set(selected);
                          s.has(o.id) ? s.delete(o.id) : s.add(o.id);
                          setSelected(s);
                        }}
                        aria-label={o.ref}
                      />
                    </td>
                    <td>
                      <button type="button" className="link font-medium" onClick={() => setOpenId(o.id)}>
                        {o.shopify_name || o.ref}
                      </button>
                      <div className="text-xs text-muted">{ago(o.created_at, lang)}</div>
                    </td>
                    <td>
                      <div className="font-medium">{o.customer_name || '—'}</div>
                      <div className="flex items-center gap-2 text-xs">
                        <a className="ltr link" href={`tel:${o.phone}`}>
                          {o.phone}
                        </a>
                        {o.call_attempts > 0 && <Badge tone="warn">☎ {o.call_attempts}</Badge>}
                        {o.tags?.includes('blacklist') && <Badge tone="bad">{t(['محظور', 'Liste noire'])}</Badge>}
                      </div>
                    </td>
                    <td className="text-xs">
                      <div>{o.wilaya ? (lang === 'ar' ? o.wilaya.ar : o.wilaya.fr) : '—'}</div>
                      <div className="text-muted">
                        {o.commune} {o.delivery_type === 'desk' && <Badge>{t('c.desk')}</Badge>}
                      </div>
                    </td>
                    <td className="max-w-[16rem] truncate text-xs" title={itemsText(o.items)}>
                      {itemsText(o.items)}
                    </td>
                    <td className="num text-end font-medium">{da(o.total)}</td>
                    <td>
                      <StatusBadge status={o.status} />
                      {o.status === 'callback' && o.callback_at && <div className="mt-0.5 text-[11px] text-muted">{dateTime(o.callback_at, lang)}</div>}
                    </td>
                    <td className="text-xs">
                      {o.carrier ? (
                        <>
                          <div>{CARRIER_NAMES[o.carrier] || o.carrier}</div>
                          <div className="ltr text-muted">{o.tracking}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    {statuses.some((s) => TABS.confirm.includes(s)) && (
                      <td>
                        <QuickConfirm o={o} busy={busy} onStatus={quick} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={ShoppingBag} title={t(['لا طلبيات هنا', 'Aucune commande ici'])} />
        )}
        {data && <Pagination total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </Card>
      <OrderDrawer
        id={openId}
        onClose={() => {
          setOpenId(null);
          if (params.get('open')) {
            params.delete('open');
            setParams(params);
          }
        }}
        onChanged={refreshAll}
      />
      <NewOrderModal
        open={newOpen}
        onClose={(id) => {
          setNewOpen(false);
          if (id) {
            refreshAll();
            setOpenId(id);
          }
        }}
      />
      <BulkShipModal
        open={bulkShip}
        orders={rows.filter((r) => selected.has(r.id))}
        onClose={(done) => {
          setBulkShip(false);
          if (done) {
            setSelected(new Set());
            refreshAll();
          }
        }}
      />
    </div>
  );
}

function QuickConfirm({ o, busy, onStatus }) {
  const { t } = useI18n();
  const [cb, setCb] = useState(false);
  const [cancel, setCancel] = useState(false);
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy === `${o.id}:confirmed`} onClick={() => onStatus(o, 'confirmed')} title={t(['تأكيد', 'Confirmer'])} />
      <Button size="sm" icon={PhoneOff} loading={busy === `${o.id}:no_answer`} onClick={() => onStatus(o, 'no_answer')} title={t(['لا يرد', 'Sans réponse'])} />
      <Button size="sm" icon={Clock} onClick={() => setCb(true)} title={t(['اتصل لاحقاً', 'Rappeler'])} />
      <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setCancel(true)} title={t(['إلغاء', 'Annuler'])} />
      <CallbackModal open={cb} onClose={() => setCb(false)} onSave={(at, note) => onStatus(o, 'callback', { callback_at: at, note })} />
      <CancelModal open={cancel} onClose={() => setCancel(false)} onSave={(reason, fake) => onStatus(o, fake ? 'fake' : 'cancelled', { cancel_reason: reason })} />
    </div>
  );
}

function CallbackModal({ open, onClose, onSave }) {
  const { t } = useI18n();
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const preset = (h) => {
    const d = new Date(Date.now() + h * 3600e3);
    d.setMinutes(0, 0, 0);
    setAt(new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t(['موعد إعادة الاتصال', 'Date de rappel'])}
      icon={Clock}
      footer={
        <Button
          variant="primary"
          disabled={!at}
          onClick={() => {
            onSave(new Date(at).toISOString(), note);
            onClose();
          }}
        >
          {t('c.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {[1, 3, 24].map((h) => (
            <Button key={h} size="sm" onClick={() => preset(h)}>
              +{h} {t(['ساعة', 'h'])}
            </Button>
          ))}
        </div>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('c.notes')} />
      </div>
    </Modal>
  );
}

function CancelModal({ open, onClose, onSave }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [fake, setFake] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t(['سبب الإلغاء', "Motif d'annulation"])}
      icon={Ban}
      footer={
        <Button
          variant="danger"
          disabled={!reason}
          onClick={() => {
            onSave(reason, fake);
            onClose();
          }}
        >
          {t(['إلغاء الطلبية', 'Annuler la commande'])}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {CANCEL_REASONS.map((r) => (
            <Button key={r[0]} size="sm" variant={reason === t(r) ? 'primary' : undefined} onClick={() => setReason(t(r))}>
              {t(r)}
            </Button>
          ))}
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(['سبب آخر…', 'Autre motif…'])} />
        <Toggle checked={fake} onChange={setFake} label={t(['طلبية مزيفة/مكررة (تُستبعد من الإحصاءات)', 'Fausse/doublon (exclue des stats)'])} />
      </div>
    </Modal>
  );
}

/** نافذة إرسال طلبية لشركة التوصيل مع ترتيب الشركات حسب الأداء في ولايتها */
export function ShipModal({ order, open, onClose }) {
  const { t, lang } = useI18n();
  const { projects } = useApp();
  const { run, busy } = useAction();
  const proj = projects.find((p) => p.id === order?.project_id);
  const configured = proj?.integrations?.carriers || [];
  const [f, setF] = useState({});
  const [rec, setRec] = useState(null);
  const [communes, setCommunes] = useState([]);
  const [desks, setDesks] = useState([]);
  useEffect(() => {
    if (!open || !order) return;
    setF({ carrier: '', delivery_type: order.delivery_type, commune: order.commune_fr || order.commune || '', stopdesk_id: order.stopdesk_id || '', note: '' });
    api
      .get(`/carriers/recommend${qs({ wilaya: order.wilaya_code, delivery_type: order.delivery_type })}`, { project: order.project_id })
      .then((r) => {
        setRec(r);
        const best = r.ranked.find((x) => x.configured)?.carrier || configured[0] || '';
        setF((x) => ({ ...x, carrier: x.carrier || best }));
      })
      .catch(() => setRec(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);
  useEffect(() => {
    if (!open || !f.carrier || !order?.wilaya_code) return;
    api.get(`/carriers/${f.carrier}/communes${qs({ wilaya: order.wilaya_code })}`, { project: order.project_id }).then(setCommunes, () => setCommunes([]));
    if (f.delivery_type === 'desk') api.get(`/carriers/${f.carrier}/desks${qs({ wilaya: order.wilaya_code })}`, { project: order.project_id }).then(setDesks, () => setDesks([]));
  }, [open, f.carrier, f.delivery_type, order?.wilaya_code, order?.project_id]);
  if (!order) return null;
  const send = async () => {
    const r = await run('ship', () => api.post(`/orders/${order.id}/ship`, f, { project: order.project_id }), { success: t(['أُرسلت الطلبية لشركة التوصيل', 'Commande envoyée au transporteur']) });
    if (r) onClose(true);
  };
  return (
    <Modal
      open={open}
      onClose={() => onClose(false)}
      title={t(['إرسال إلى شركة التوصيل', 'Envoyer au transporteur'])}
      icon={Truck}
      size="lg"
      footer={
        <>
          <Button onClick={() => onClose(false)}>{t('c.cancel')}</Button>
          <Button variant="primary" icon={Send} loading={busy === 'ship'} disabled={!f.carrier || (f.delivery_type === 'desk' && !f.stopdesk_id && f.carrier === 'yalidine')} onClick={send}>
            {t(['إرسال', 'Envoyer'])}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-raised px-3 py-2 text-sm">
          <b>{order.customer_name}</b> · <span className="ltr">{order.phone}</span> · {order.wilaya ? `${order.wilaya.code} - ${lang === 'ar' ? order.wilaya.ar : order.wilaya.fr}` : ''} · {da(order.total)}
        </div>
        <div>
          <div className="label">{t(['ترتيب الشركات في هذه الولاية (نسبة التسليم، السرعة، جدية الموزع، السعر)', 'Classement dans cette wilaya (livraison, rapidité, sérieux du livreur, prix)'])}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(rec?.ranked || configured.map((c) => ({ carrier: c, configured: true }))).map((r, k) => (
              <button
                key={r.carrier}
                type="button"
                disabled={!r.configured}
                onClick={() => setF({ ...f, carrier: r.carrier })}
                className={cx('card flex flex-col gap-1 p-3 text-start transition disabled:opacity-40', f.carrier === r.carrier ? 'border-brand ring-2 ring-brand/30' : 'hover:border-brand/40')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{CARRIER_NAMES[r.carrier] || r.carrier}</span>
                  {k === 0 && r.score !== undefined && <Badge tone="good">{t(['الأفضل', 'Meilleur'])}</Badge>}
                </div>
                {r.score !== undefined && (
                  <div className="text-xs text-sub">
                    {t(['التقييم', 'Score'])} <b className="num text-ink">{r.score}</b> · {t(['تسليم', 'Livr.'])} {r.estimated.success_rate}% · {r.estimated.avg_days} {t(['يوم', 'j'])}
                  </div>
                )}
                {r.fee ? <div className="text-xs text-muted">{da(r.fee)}</div> : null}
                {r.confidence && <div className="text-[11px] text-muted">{t(['ثقة', 'Confiance'])}: {r.confidence} · n={r.local?.closed ?? 0}</div>}
                {!r.configured && <div className="text-[11px] text-bad">{t(['غير مربوطة', 'Non connecté'])}</div>}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t(['نوع التوصيل', 'Type de livraison'])}>
            <Select
              value={f.delivery_type}
              onChange={(e) => setF({ ...f, delivery_type: e.target.value })}
              options={[
                { value: 'home', label: t('c.home') },
                { value: 'desk', label: t('c.desk') },
              ]}
            />
          </Field>
          <Field label={t('c.commune')} hint={communes.length ? null : t(['تُجلب قائمة البلديات من شركة التوصيل', 'Liste des communes du transporteur'])}>
            {communes.length ? (
              <Select value={f.commune} onChange={(e) => setF({ ...f, commune: e.target.value })} placeholder={t('c.select')} options={communes.map((c) => ({ value: c.name, label: c.name }))} />
            ) : (
              <Input value={f.commune || ''} onChange={(e) => setF({ ...f, commune: e.target.value })} />
            )}
          </Field>
          {f.delivery_type === 'desk' && (
            <Field label={t(['المكتب', 'Bureau / stop-desk'])} className="sm:col-span-2">
              <Select value={f.stopdesk_id} onChange={(e) => setF({ ...f, stopdesk_id: e.target.value })} placeholder={t('c.select')} options={desks.map((d) => ({ value: d.id, label: `${d.name}${d.commune ? ` — ${d.commune}` : ''}` }))} />
            </Field>
          )}
          <Field label={t(['ملاحظة للموزع', 'Note au livreur'])} className="sm:col-span-2">
            <Input value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function BulkShipModal({ open, orders, onClose }) {
  const { t } = useI18n();
  const [mode, setMode] = useState('best');
  const [carrier, setCarrier] = useState('');
  const [progress, setProgress] = useState(null);
  const run = async () => {
    const results = [];
    setProgress({ done: 0, total: orders.length, results });
    for (const o of orders) {
      let c = carrier;
      try {
        if (mode === 'best') {
          const r = await api.get(`/carriers/recommend${qs({ wilaya: o.wilaya_code, delivery_type: o.delivery_type })}`, { project: o.project_id });
          c = r.ranked.find((x) => x.configured)?.carrier;
        }
        if (!c) throw new Error('no_carrier');
        const out = await api.post(`/orders/${o.id}/ship`, { carrier: c }, { project: o.project_id });
        results.push({ id: o.id, ok: true, label: `${o.shopify_name || o.ref} → ${CARRIER_NAMES[c]} ${out.tracking || ''}` });
      } catch (e) {
        results.push({ id: o.id, ok: false, label: `${o.shopify_name || o.ref}: ${e.code || e.message}` });
      }
      setProgress({ done: results.length, total: orders.length, results: [...results] });
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        const done = Boolean(progress);
        setProgress(null);
        onClose(done);
      }}
      title={t(['شحن {n} طلبية', 'Expédier {n} commandes'], { n: orders.length })}
      icon={Truck}
      footer={
        !progress && (
          <Button variant="primary" icon={Send} disabled={mode === 'one' && !carrier} onClick={run}>
            {t(['إرسال', 'Envoyer'])}
          </Button>
        )
      }
    >
      {!progress ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" checked={mode === 'best'} onChange={() => setMode('best')} className="mt-1" />
            <span>
              <b>{t(['أفضل شركة لكل ولاية (موصى به)', 'Meilleur transporteur par wilaya (recommandé)'])}</b>
              <span className="block text-xs text-sub">{t(['حسب نسبة التسليم والسرعة وجدية الموزع والسعر في بياناتك', 'Selon livraison, rapidité, sérieux et prix dans vos données'])}</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === 'one'} onChange={() => setMode('one')} />
            <span>{t(['شركة واحدة للكل', 'Un seul transporteur'])}</span>
            <Select className="w-auto" disabled={mode !== 'one'} value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t('c.select')} options={Object.entries(CARRIER_NAMES).map(([k, v]) => ({ value: k, label: v }))} />
          </label>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="num">
            {progress.done} / {progress.total}
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {progress.results.map((r) => (
              <li key={r.id} className={cx('flex items-center gap-2', r.ok ? 'text-good' : 'text-bad')}>
                {r.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                <span className="text-ink">{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/** لوحة الطلبية الكاملة (تُستعمل في الطلبيات والزبائن والسلات المتروكة) */
export function OrderDrawer({ id, onClose, onChanged }) {
  const { t, lang } = useI18n();
  const { meta, wilayaName } = useApp();
  const statusLabel = useStatusLabel();
  const { run, busy } = useAction();
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null);
  const [note, setNote] = useState('');
  const [ship, setShip] = useState(false);
  const [cb, setCb] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [track, setTrack] = useState({ carrier: '', tracking: '' });

  const load = async () => {
    if (!id) return;
    try {
      setO(await api.get(`/orders/${id}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    setO(null);
    setEdit(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const changed = () => {
    load();
    onChanged?.();
  };
  const setStatus = async (to, extra = {}) => {
    const r = await run(`st:${to}`, () => api.post(`/orders/${o.id}/status`, { status: to, ...extra }), { success: false });
    if (r) changed();
  };
  const next = useMemo(() => (o ? (meta?.transitions?.[o.status] || []).filter((s) => s !== o.status) : []), [o, meta]);
  if (!id) return null;

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={
        o ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{o.shopify_name || o.ref}</span>
            <StatusBadge status={o.status} />
            <span className="text-xs font-normal text-muted">{dateTime(o.created_at, lang)}</span>
          </div>
        ) : (
          '…'
        )
      }
      footer={
        o && (
          <>
            {o.status === 'confirmed' && (
              <Button variant="primary" icon={Truck} onClick={() => setShip(true)}>
                {t(['إرسال لشركة التوصيل', 'Envoyer au transporteur'])}
              </Button>
            )}
            {['new', 'no_answer', 'callback', 'abandoned'].includes(o.status) && (
              <>
                <Button variant="primary" icon={CheckCircle2} loading={busy === 'st:confirmed'} onClick={() => setStatus('confirmed')}>
                  {t(['تأكيد', 'Confirmer'])}
                </Button>
                <Button icon={PhoneOff} loading={busy === 'st:no_answer'} onClick={() => setStatus('no_answer')}>
                  {t(['لا يرد', 'Sans réponse'])}
                </Button>
                <Button icon={Clock} onClick={() => setCb(true)}>
                  {t(['لاحقاً', 'Rappeler'])}
                </Button>
                <Button variant="ghost" icon={XCircle} onClick={() => setCancel(true)}>
                  {t(['إلغاء', 'Annuler'])}
                </Button>
              </>
            )}
            {o.tracking && (
              <Button icon={RefreshCw} loading={busy === 'sync'} onClick={() => run('sync', () => api.post(`/orders/${o.id}/sync-tracking`, {}, { project: o.project_id }), { success: t(['تم تحديث التتبع', 'Suivi actualisé']) }).then(changed)}>
                {t(['تحديث التتبع', 'Actualiser le suivi'])}
              </Button>
            )}
            {o.tracking && (
              <a className="btn" href={`/api/orders/${o.id}/label`} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4" />
                {t(['الملصق', 'Étiquette'])}
              </a>
            )}
            <span className="flex-1" />
            <Button
              variant="ghost"
              icon={Trash2}
              onClick={() =>
                run('del', () => api.del(`/orders/${o.id}`), { success: t(['حُذفت', 'Supprimée']) }).then((r) => {
                  if (r) {
                    onChanged?.();
                    onClose();
                  }
                })
              }
            />
          </>
        )
      }
    >
      {error && <ErrorBox error={error} onRetry={load} />}
      {!o && !error && <Loading />}
      {o && (
        <div className="space-y-4">
          {o.customer && (o.customer.previous > 0 || o.customer.blacklisted) && (
            <div className={cx('rounded-lg border px-3 py-2 text-sm', o.customer.risk === 'high' ? 'border-bad/40 bg-bad/5' : o.customer.risk === 'medium' ? 'border-warn/40 bg-warn/5' : 'border-good/40 bg-good/5')}>
              <div className="flex flex-wrap items-center gap-2">
                <User className="h-4 w-4" />
                <b>{t(['تاريخ الزبون', 'Historique client'])}</b>
                <Badge tone={o.customer.risk === 'high' ? 'bad' : o.customer.risk === 'medium' ? 'warn' : 'good'}>{t(['الخطر', 'Risque'])}: {o.customer.risk}</Badge>
                {o.customer.blacklisted && <Badge tone="bad">{t(['محظور', 'Liste noire'])}</Badge>}
              </div>
              <div className="mt-1 text-xs text-sub">
                {t(['{o} طلبية · {d} مسلّمة · {r} مرتجعة · {c} ملغاة', '{o} commandes · {d} livrées · {r} retours · {c} annulées'], { o: o.customer.orders, d: o.customer.delivered, r: o.customer.returned, c: o.customer.cancelled })}
                {o.customer.open_duplicates > 0 && <b className="text-warn"> · {t(['{n} طلبية مفتوحة أخرى (مكررة؟)', '{n} autre(s) commande(s) ouverte(s) (doublon ?)'], { n: o.customer.open_duplicates })}</b>}
              </div>
            </div>
          )}

          <Card
            title={t(['الزبون والتوصيل', 'Client & livraison'])}
            actions={
              !edit && (
                <Button size="sm" onClick={() => setEdit({ customer_name: o.customer_name, phone: o.phone, phone2: o.phone2, wilaya_code: o.wilaya_code, commune: o.commune, address: o.address, delivery_type: o.delivery_type, notes: o.notes })}>
                  {t('c.edit')}
                </Button>
              )
            }
          >
            {!edit ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Info icon={User} label={t('c.name')} value={o.customer_name} />
                <Info
                  icon={Phone}
                  label={t('c.phone')}
                  value={
                    <span className="flex flex-wrap items-center gap-2">
                      <a className="ltr link" href={`tel:${o.phone}`}>
                        {o.phone}
                      </a>
                      {o.phone2 && <span className="ltr text-sub">{o.phone2}</span>}
                      {waLink(o.phone) && (
                        <a className="btn btn-sm" href={waLink(o.phone)} target="_blank" rel="noreferrer">
                          <MessageSquare className="h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      )}
                    </span>
                  }
                />
                <Info icon={MapPin} label={t('c.wilaya')} value={`${wilayaName(o.wilaya_code, lang)} · ${o.commune || '—'}`} />
                <Info icon={Truck} label={t(['نوع التوصيل', 'Livraison'])} value={o.delivery_type === 'desk' ? t('c.desk') : t('c.home')} />
                <Info label={t('c.address')} value={o.address} className="sm:col-span-2" />
                {o.notes && <Info label={t('c.notes')} value={o.notes} className="sm:col-span-2" />}
                {(o.utm_source || o.utm_content) && <Info label={t('c.source')} value={[o.source, o.utm_source, o.utm_campaign, o.utm_content].filter(Boolean).join(' · ')} className="sm:col-span-2" />}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('c.name')}>
                  <Input value={edit.customer_name || ''} onChange={(e) => setEdit({ ...edit, customer_name: e.target.value })} />
                </Field>
                <Field label={t('c.phone')}>
                  <Input className="ltr" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                </Field>
                <Field label={t(['هاتف ثانٍ', 'Téléphone 2'])}>
                  <Input className="ltr" value={edit.phone2 || ''} onChange={(e) => setEdit({ ...edit, phone2: e.target.value })} />
                </Field>
                <Field label={t('c.wilaya')}>
                  <Select value={edit.wilaya_code || ''} onChange={(e) => setEdit({ ...edit, wilaya_code: e.target.value })} options={(meta?.wilayas || []).map((w) => ({ value: w.code, label: wilayaName(w.code, lang) }))} />
                </Field>
                <Field label={t('c.commune')}>
                  <Input value={edit.commune || ''} onChange={(e) => setEdit({ ...edit, commune: e.target.value })} />
                </Field>
                <Field label={t(['نوع التوصيل', 'Livraison'])}>
                  <Select
                    value={edit.delivery_type}
                    onChange={(e) => setEdit({ ...edit, delivery_type: e.target.value })}
                    options={[
                      { value: 'home', label: t('c.home') },
                      { value: 'desk', label: t('c.desk') },
                    ]}
                  />
                </Field>
                <Field label={t('c.address')} className="sm:col-span-2">
                  <Input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
                </Field>
                <Field label={t('c.notes')} className="sm:col-span-2">
                  <Textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                </Field>
                <div className="flex gap-2 sm:col-span-2">
                  <Button
                    variant="primary"
                    loading={busy === 'edit'}
                    onClick={async () => {
                      const r = await run('edit', () => api.patch(`/orders/${o.id}`, edit));
                      if (r) {
                        setEdit(null);
                        changed();
                      }
                    }}
                  >
                    {t('c.save')}
                  </Button>
                  <Button onClick={() => setEdit(null)}>{t('c.cancel')}</Button>
                </div>
              </div>
            )}
          </Card>

          <Card title={t('c.products')} pad={false}>
            <table className="table">
              <tbody>
                {o.items.map((i, k) => (
                  <tr key={k}>
                    <td>
                      {i.product_id ? (
                        <Link className="link" to={`/products/${i.product_id}`}>
                          {i.title}
                        </Link>
                      ) : (
                        i.title
                      )}
                      {i.variant && <span className="text-xs text-muted"> · {i.variant}</span>}
                    </td>
                    <td className="num text-end">× {i.qty}</td>
                    <td className="num text-end">{da(i.price * i.qty)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="text-sub">{t(['التوصيل', 'Livraison'])}</td>
                  <td />
                  <td className="num text-end">{da(o.shipping_fee)}</td>
                </tr>
                {o.discount > 0 && (
                  <tr>
                    <td className="text-sub">{t(['تخفيض', 'Remise'])}</td>
                    <td />
                    <td className="num text-end">−{da(o.discount)}</td>
                  </tr>
                )}
                <tr>
                  <td className="font-semibold">{t('c.total')}</td>
                  <td />
                  <td className="num text-end font-semibold">{da(o.total)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          {(o.carrier || o.status === 'confirmed') && (
            <Card title={t(['التوصيل', 'Livraison'])}>
              {o.carrier ? (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{CARRIER_NAMES[o.carrier]}</b>
                    <span className="ltr rounded bg-raised px-2 py-0.5 font-mono text-xs">{o.tracking}</span>
                    {o.carrier_status_raw && <Badge>{o.carrier_status_raw}</Badge>}
                    {o.delivery_attempts > 0 && <Badge tone="warn">{t(['محاولات التسليم', 'Tentatives'])}: {o.delivery_attempts}</Badge>}
                  </div>
                  {['at_office', 'attempt_failed', 'out_for_delivery', 'returning'].includes(o.status) && <DeliveryContacts order={o} />}
                  {['delivered', 'returned', 'attempt_failed', 'out_for_delivery', 'at_office'].includes(o.status) && (
                    <div className="flex flex-wrap items-center gap-4 rounded-lg bg-raised px-3 py-2">
                      <span className="text-xs text-sub">{t(['تقييم الموزع (يُستعمل في اختيار الشركة الأفضل):', 'Évaluer le livreur (utilisé pour le meilleur transporteur) :'])}</span>
                      <Toggle checked={Boolean(o.livreur_called)} onChange={(v) => run('lc', () => api.patch(`/orders/${o.id}`, { livreur_called: v }), { success: false }).then(changed)} label={t(['اتصل الموزع بالزبون', 'Le livreur a appelé'])} />
                      <span className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button key={s} type="button" onClick={() => run('lr', () => api.patch(`/orders/${o.id}`, { livreur_rating: s }), { success: false }).then(changed)} aria-label={`${s}`}>
                            <Star className={cx('h-4 w-4', s <= (o.livreur_rating || 0) ? 'fill-warn text-warn' : 'text-muted')} />
                          </button>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t(['ربط رقم تتبع يدوياً', 'Lier un suivi manuellement'])}>
                    <Select value={track.carrier} onChange={(e) => setTrack({ ...track, carrier: e.target.value })} placeholder={t('c.carrier')} options={Object.entries(CARRIER_NAMES).map(([k, v]) => ({ value: k, label: v }))} />
                  </Field>
                  <Input className="ltr w-48" value={track.tracking} onChange={(e) => setTrack({ ...track, tracking: e.target.value })} placeholder="Tracking" />
                  <Button disabled={!track.carrier || !track.tracking} loading={busy === 'track'} onClick={() => run('track', () => api.post(`/orders/${o.id}/tracking`, track)).then((r) => r && changed())}>
                    {t('c.save')}
                  </Button>
                </div>
              )}
            </Card>
          )}

          {next.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-sub">{t(['تغيير الحالة يدوياً:', 'Changer le statut :'])}</span>
              {next.map((s) => (
                <Button key={s} size="sm" loading={busy === `st:${s}`} onClick={() => setStatus(s)}>
                  {statusLabel(s)}
                </Button>
              ))}
            </div>
          )}

          <Card title={t(['السجل', 'Historique'])}>
            <ol className="relative space-y-3 border-s border-line ps-4">
              {o.events
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-surface bg-brand" />
                    <div className="flex flex-wrap items-center gap-2">
                      {e.to_status && e.type !== 'note' ? <StatusBadge status={e.to_status} /> : <Badge>{e.type}</Badge>}
                      <span className="text-xs text-muted">{dateTime(e.at, lang)}</span>
                      <span className="text-xs text-muted">· {e.user_name || e.source}</span>
                    </div>
                    {(e.note || e.raw || e.location) && <div className="mt-1 text-xs text-sub">{[e.raw, e.location, e.note].filter(Boolean).join(' · ')}</div>}
                  </li>
                ))}
            </ol>
            <div className="mt-4 flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(['أضف ملاحظة…', 'Ajouter une note…'])} />
              <Button
                disabled={!note.trim()}
                loading={busy === 'note'}
                onClick={async () => {
                  const r = await run('note', () => api.post(`/orders/${o.id}/note`, { note }), { success: false });
                  if (r !== undefined) {
                    setNote('');
                    changed();
                  }
                }}
              >
                {t('c.add')}
              </Button>
            </div>
          </Card>
          <ShipModal
            order={o}
            open={ship}
            onClose={(done) => {
              setShip(false);
              if (done) changed();
            }}
          />
          <CallbackModal open={cb} onClose={() => setCb(false)} onSave={(at, n) => setStatus('callback', { callback_at: at, note: n })} />
          <CancelModal open={cancel} onClose={() => setCancel(false)} onSave={(reason, fake) => setStatus(fake ? 'fake' : 'cancelled', { cancel_reason: reason })} />
        </div>
      )}
    </Drawer>
  );
}

function Info({ icon: Icon, label, value, className }) {
  return (
    <div className={className}>
      <div className="mb-0.5 flex items-center gap-1 text-xs text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="text-ink">{value || '—'}</div>
    </div>
  );
}

function NewOrderModal({ open, onClose }) {
  const { t, lang } = useI18n();
  const { meta, wilayaName } = useApp();
  const { run, busy } = useAction();
  const products = useApi('/products', { skip: !open });
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open) setF({ customer_name: '', phone: '', wilaya: '', commune: '', address: '', delivery_type: 'home', shipping_fee: '', items: [{ product_id: '', qty: 1, price: '' }], notes: '' });
  }, [open]);
  if (!f) return null;
  const setItem = (k, patch) => setF({ ...f, items: f.items.map((i, j) => (j === k ? { ...i, ...patch } : i)) });
  const save = async () => {
    const items = f.items
      .filter((i) => i.product_id || i.title)
      .map((i) => {
        const p = products.data?.find((x) => String(x.id) === String(i.product_id));
        return { product_id: p?.id, title: p?.title || i.title, qty: Number(i.qty) || 1, price: Number(i.price || p?.price || 0) };
      });
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const r = await run('save', () => api.post('/orders', { ...f, items, shipping_fee: Number(f.shipping_fee) || 0, total: subtotal + (Number(f.shipping_fee) || 0) }));
    if (r) onClose(r.id);
  };
  return (
    <Modal
      open={open}
      onClose={() => onClose(null)}
      title={t(['طلبية يدوية', 'Commande manuelle'])}
      icon={Plus}
      size="lg"
      footer={
        <Button variant="primary" loading={busy === 'save'} disabled={!f.phone || !f.wilaya || !f.items.some((i) => i.product_id)} onClick={save}>
          {t('c.create')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('c.name')}>
          <Input value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} />
        </Field>
        <Field label={t('c.phone')}>
          <Input className="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="05XXXXXXXX" />
        </Field>
        <Field label={t('c.wilaya')}>
          <Select value={f.wilaya} onChange={(e) => setF({ ...f, wilaya: e.target.value })} placeholder={t('c.select')} options={(meta?.wilayas || []).map((w) => ({ value: w.code, label: wilayaName(w.code, lang) }))} />
        </Field>
        <Field label={t('c.commune')}>
          <Input value={f.commune} onChange={(e) => setF({ ...f, commune: e.target.value })} />
        </Field>
        <Field label={t('c.address')}>
          <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label={t(['نوع التوصيل', 'Livraison'])}>
          <Select
            value={f.delivery_type}
            onChange={(e) => setF({ ...f, delivery_type: e.target.value })}
            options={[
              { value: 'home', label: t('c.home') },
              { value: 'desk', label: t('c.desk') },
            ]}
          />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <div className="label">{t('c.products')}</div>
          {f.items.map((i, k) => (
            <div key={k} className="flex gap-2">
              <Select
                className="flex-1"
                value={i.product_id}
                onChange={(e) => {
                  const p = products.data?.find((x) => String(x.id) === e.target.value);
                  setItem(k, { product_id: e.target.value, price: p?.price ?? '' });
                }}
                placeholder={t('c.select')}
                options={(products.data || []).map((p) => ({ value: p.id, label: `${p.title} — ${n0(p.price)} DA` }))}
              />
              <Input className="w-20" type="number" min="1" value={i.qty} onChange={(e) => setItem(k, { qty: e.target.value })} />
              <Input className="w-28" type="number" value={i.price} onChange={(e) => setItem(k, { price: e.target.value })} placeholder={t('c.price')} />
            </div>
          ))}
          <Button size="sm" icon={Plus} onClick={() => setF({ ...f, items: [...f.items, { product_id: '', qty: 1, price: '' }] })}>
            {t(['منتج آخر', 'Autre produit'])}
          </Button>
        </div>
        <Field label={t(['سعر التوصيل', 'Frais de livraison'])}>
          <Input type="number" value={f.shipping_fee} onChange={(e) => setF({ ...f, shipping_fee: e.target.value })} />
        </Field>
        <Field label={t('c.notes')}>
          <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      {products.data && products.data.length === 0 && <p className="mt-2 text-xs text-muted">{t(['لا منتجات بعد — زامن من Shopify أو أضف منتجاً', 'Aucun produit — synchronisez Shopify ou ajoutez-en un'])}</p>}
      <p className="mt-3 text-xs text-muted">
        <ExternalLink className="me-1 inline h-3 w-3" />
        {t(['الطلبيات من المتجر وn8n تصل تلقائياً؛ هذه للطلبيات الهاتفية فقط.', 'Les commandes boutique/n8n arrivent automatiquement ; ceci est pour les commandes téléphoniques.'])}
      </p>
    </Modal>
  );
}
