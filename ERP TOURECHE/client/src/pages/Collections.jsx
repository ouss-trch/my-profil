import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, Eye, HandCoins, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { da, dateOnly, n0, shortDay, todayDz } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { CARRIER_NAMES } from '../components/status.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Stat, Textarea, cx, useAction, useToast } from '../components/ui.jsx';

const name = (k) => CARRIER_NAMES[k] || k;
const diffTone = (d) => (Math.abs(d) < 1 ? 'good' : d < 0 ? 'bad' : 'warn');

/** تسجيل دفعة: مطابقة كشف الشركة (أرقام التتبع) أو اختيار الطلبيات يدوياً، والفرق يظهر قبل الحفظ */
function PayoutModal({ carrier, onClose, onSaved }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const { data: open, error, loading } = useApi(`/collections/open${qs({ carrier })}`);
  const [text, setText] = useState('');
  const [match, setMatch] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [f, setF] = useState({ amount: '', received_on: todayDz(), reference: '' });
  const rows = open || [];
  const expected = rows.filter((o) => sel.has(o.id)).reduce((a, o) => a + o.net, 0);
  const diff = f.amount === '' ? null : Number(f.amount) - expected;
  const allSel = rows.length > 0 && sel.size === rows.length;
  const toggle = (id) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const doMatch = () =>
    run('match', () => api.post('/collections/match', { carrier, text }), { success: false }).then((m) => {
      if (!m) return;
      setMatch(m);
      setSel(new Set(m.open.map((o) => o.id)));
    });
  const save = () =>
    run('save', () => api.post('/collections', { carrier, order_ids: [...sel], amount: Number(f.amount), received_on: f.received_on, reference: f.reference }), {
      success: t([`سُجّلت دفعة ${name(carrier)}`, `Versement ${name(carrier)} enregistré`]),
    }).then((r) => r && onSaved());

  return (
    <Modal
      open
      size="lg"
      icon={HandCoins}
      onClose={onClose}
      title={t([`دفعة من ${name(carrier)}`, `Versement de ${name(carrier)}`])}
      footer={
        <>
          <div className="me-auto flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{t(['المتوقع', 'Attendu'])}:</span>
            <span className="num font-semibold">{da(expected)}</span>
            {diff !== null && sel.size > 0 && (
              <Badge tone={diffTone(diff)}>
                {t(['الفرق', 'Écart'])} {da(diff)}
              </Badge>
            )}
          </div>
          <Button variant="primary" loading={busy === 'save'} disabled={!sel.size || f.amount === ''} onClick={save}>
            {t(['حفظ الدفعة', 'Enregistrer']) + (sel.size ? ` (${sel.size})` : '')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t(['أرقام التتبع من كشف الدفع', 'Numéros de suivi du relevé'])} hint={t(['انسخها من كشف الشركة كما هي (Excel أو PDF): تُستخرج الأرقام وحدها وتُحدَّد طلبياتها.', 'Collez-les tels quels (Excel ou PDF) : les numéros sont extraits et leurs commandes cochées.'])}>
          <Textarea className="ltr min-h-[90px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'yal-A1B2C3\nyal-D4E5F6'} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={ListChecks} loading={busy === 'match'} disabled={!text.trim()} onClick={doMatch}>
            {t(['مطابقة', 'Rapprocher'])}
          </Button>
          {match && (
            <>
              <Badge tone="good">{t([`مطابقة ${match.open.length}`, `${match.open.length} trouvées`])}</Badge>
              {match.already_paid.length > 0 && <Badge tone="warn">{t([`دُفعت سابقاً ${match.already_paid.length}`, `${match.already_paid.length} déjà payées`])}</Badge>}
              {match.not_closed.length > 0 && <Badge tone="warn">{t([`غير مسلّمة في الـ ERP ${match.not_closed.length}`, `${match.not_closed.length} non livrées dans l’ERP`])}</Badge>}
              {match.unknown.length > 0 && (
                <Badge tone="bad" title={match.unknown.join(' · ')}>
                  {t([`مجهولة ${match.unknown.length}`, `${match.unknown.length} inconnues`])}
                </Badge>
              )}
            </>
          )}
        </div>
        {match?.not_closed.length > 0 && (
          <p className="text-xs text-sub">
            {t(['حدّث التتبع لهذه الطلبيات ثم أعد المطابقة:', 'Mettez à jour le suivi puis rapprochez à nouveau :'])} <span className="ltr">{match.not_closed.map((o) => o.number || o.tracking).join(', ')}</span>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t(['المبلغ المستلم (دج)', 'Montant reçu (DA)'])}>
            <Input type="number" inputMode="numeric" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={t(['تاريخ الاستلام', 'Date de réception'])}>
            <Input type="date" value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} />
          </Field>
          <Field label={t(['رقم الكشف', 'N° du relevé'])}>
            <Input className="ltr" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
        </div>
        {loading && !open ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !rows.length ? (
          <Empty icon={HandCoins} title={t(['لا طلبيات مفتوحة عند هذه الشركة', 'Aucune commande ouverte chez ce transporteur'])} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((o) => o.id)))} aria-label={t(['تحديد الكل', 'Tout sélectionner'])} />
                  </th>
                  <th>{t(['الطلبية', 'Commande'])}</th>
                  <th>{t(['أُغلقت', 'Clôturée'])}</th>
                  <th className="text-end">{t(['الصافي', 'Net'])}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={cx(sel.has(o.id) && 'bg-brand/5')}>
                    <td>
                      <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`${t(['تحديد', 'Sélectionner'])} ${o.number || o.tracking}`} />
                    </td>
                    <td>
                      <span className="num font-medium">{o.number || '—'}</span>
                      {o.status === 'returned' && (
                        <Badge tone="warn" className="ms-1.5">
                          {t(['مرتجعة', 'Retour'])}
                        </Badge>
                      )}
                      <div className="text-xs text-muted">
                        {o.customer_name} · <span className="ltr inline-block" data-tracking>{o.tracking}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {shortDay(o.closed_on, lang)}
                      <div className={o.days > 14 ? 'text-warn' : 'text-muted'}>{t([`${o.days} يوماً`, `${o.days} j`])}</div>
                    </td>
                    <td className="num whitespace-nowrap text-end">
                      {da(o.net)}
                      {!o.fee_known && <div className="text-xs text-warn">{t(['سعر التوصيل؟', 'Frais ?'])}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function OpeningModal({ onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const { run, busy } = useAction();
  const [before, setBefore] = useState(todayDz());
  return (
    <Modal
      open
      size="sm"
      icon={CalendarCheck}
      onClose={onClose}
      title={t(['رصيد افتتاحي', 'Solde d’ouverture'])}
      footer={
        <Button
          variant="primary"
          loading={busy === 'open'}
          onClick={() =>
            run('open', () => api.post('/collections/opening', { before }), { success: false }).then((r) => {
              if (!r) return;
              const n = r.results.reduce((a, x) => a + x.orders_count, 0);
              toast.ok(t([`سُوّيت ${n} طلبية حتى ${before}`, `${n} commandes soldées jusqu’au ${before}`]));
              onSaved();
            })
          }
        >
          {t(['اعتبرها مدفوعة', 'Marquer comme versées'])}
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-sub">{t(['كل طلبية سُلّمت أو أُرجعت حتى هذا التاريخ تُعدّ مدفوعة من شركة التوصيل، ويبدأ التتبع بعده. اختر تاريخ آخر دفعة استلمتها فعلاً.', 'Toute commande livrée ou retournée jusqu’à cette date est considérée versée ; le suivi commence après. Choisissez la date de votre dernier versement reçu.'])}</p>
        <Field label={t(['حتى تاريخ', 'Jusqu’au'])}>
          <Input type="date" value={before} max={todayDz()} onChange={(e) => setBefore(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">{t(['تُطلب كلمة مرور العمليات الحساسة. يمكن التراجع بحذف سطر «رصيد افتتاحي».', 'Mot de passe sensible requis. Annulable en supprimant la ligne « Solde d’ouverture ».'])}</p>
      </div>
    </Modal>
  );
}

function PayoutOrders({ payout, onClose }) {
  const { t, lang } = useI18n();
  const { data, error, loading } = useApi(`/collections/${payout.id}/orders`);
  return (
    <Modal open size="lg" onClose={onClose} title={`${name(payout.carrier)} · ${dateOnly(payout.received_on, lang)}${payout.reference ? ` · ${payout.reference}` : ''}`}>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <tbody>
              {(data || []).map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.number || '—'}</td>
                  <td className="ltr text-xs">{o.tracking}</td>
                  <td className="text-xs text-muted">{o.customer_name}</td>
                  <td className="num text-end">{da(o.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Collections() {
  const { t, lang } = useI18n();
  const { isAll } = useApp();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi('/collections');
  const { run, busy } = useAction();
  const [opening, setOpening] = useState(false);
  const [viewing, setViewing] = useState(null);
  const paying = params.get('carrier');
  const setPaying = (c) => setParams(c ? { carrier: c } : {}, { replace: true });
  const carriers = data?.carriers || [];
  const lateTotal = useMemo(() => carriers.reduce((a, c) => a + c.late_net, 0), [carriers]);
  const needProject = isAll ? t(['اختر مشروعاً أولاً', 'Choisissez un projet']) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={HandCoins}
        title={t('nav.collections')}
        subtitle={t(['المال الذي قبضته شركات التوصيل من زبائنك ولم يصلك بعد، ودفعاتها مطابقة طلبية بطلبية.', 'L’argent encaissé par les transporteurs et pas encore reversé, rapproché commande par commande.'])}
        actions={
          <Button icon={CalendarCheck} disabled={isAll} title={needProject} onClick={() => setOpening(true)}>
            {t(['رصيد افتتاحي', 'Solde d’ouverture'])}
          </Button>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          {!data.started && carriers.length > 0 && (
            <Card>
              <div className="flex flex-wrap items-center gap-3">
                <CalendarCheck className="h-5 w-5 shrink-0 text-brand" />
                <p className="min-w-0 flex-1 text-sm text-sub">
                  {t(['ابدأ بـ«رصيد افتتاحي» حتى تاريخ آخر دفعة استلمتها: يُعدّ ما قبله مدفوعاً، ثم سجّل كل دفعة جديدة بلصق أرقام التتبع من كشف الشركة.', 'Commencez par un « solde d’ouverture » à la date du dernier versement reçu, puis enregistrez chaque versement en collant les numéros du relevé.'])}
                </p>
                <Button variant="primary" icon={CalendarCheck} disabled={isAll} title={needProject} onClick={() => setOpening(true)}>
                  {t(['رصيد افتتاحي', 'Solde d’ouverture'])}
                </Button>
              </div>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t(['عند شركات التوصيل (صافي)', 'Chez les transporteurs (net)'])} value={da(data.total_net)} icon={HandCoins} />
            <Stat label={t([`متأخر أكثر من ${data.wait_days} يوماً`, `En retard > ${data.wait_days} j`])} value={da(lateTotal)} tone={lateTotal > 0 ? 'bad' : 'good'} />
          </div>
          {!carriers.length ? (
            <Card>
              <Empty icon={HandCoins} title={t(['لا مال عند شركات التوصيل', 'Rien chez les transporteurs'])}>
                {t(['تظهر هنا الطلبيات المسلّمة والمرتجعة حتى تُسجَّل الدفعة التي سوّتها.', 'Les commandes livrées et retournées apparaissent ici jusqu’à leur versement.'])}
              </Empty>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {carriers.map((c) => (
                <Card key={c.carrier} title={name(c.carrier)} actions={c.late_count > 0 ? <Badge tone="bad">{t([`${c.late_count} متأخرة`, `${c.late_count} en retard`])}</Badge> : null}>
                  <div className="num text-2xl font-bold">{da(c.net)}</div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">{t(['مسلّمة', 'Livrées'])}</dt>
                    <dd className="num">{n0(c.delivered_count)}</dd>
                    <dt className="text-muted">{t(['مرتجعة (سعر الإرجاع)', 'Retours (frais)'])}</dt>
                    <dd className="num">{n0(c.returned_count)}</dd>
                    <dt className="text-muted">{t(['المقبوض − التوصيل', 'Encaissé − livraison'])}</dt>
                    <dd className="num">
                      {da(c.cash)} − {da(c.fees)}
                    </dd>
                    <dt className="text-muted">{t(['أقدم طلبية', 'Plus ancienne'])}</dt>
                    <dd className={cx('num', c.oldest_days > data.wait_days && 'text-bad')}>{t([`${c.oldest_days} يوماً`, `${c.oldest_days} jours`])}</dd>
                    <dt className="text-muted">{t(['آخر دفعة', 'Dernier versement'])}</dt>
                    <dd>{c.last_payout ? dateOnly(c.last_payout, lang) : '—'}</dd>
                  </dl>
                  {c.fee_unknown > 0 && (
                    <p className="mt-2 text-xs text-warn">
                      {t([`سعر التوصيل غير معروف لـ ${c.fee_unknown} طلبية: الصافي الحقيقي أقل. حدّث الأسعار من «شركات التوصيل».`, `Frais inconnus pour ${c.fee_unknown} commandes : le net réel est plus bas. Mettez à jour les tarifs.`])}
                    </p>
                  )}
                  <Button className="mt-3 w-full" variant="primary" icon={Plus} disabled={isAll || !(c.delivered_count + c.returned_count)} title={needProject} onClick={() => setPaying(c.carrier)}>
                    {t(['تسجيل دفعة', 'Enregistrer un versement'])}
                  </Button>
                </Card>
              ))}
            </div>
          )}
          <Card title={t(['الدفعات المسجلة', 'Versements enregistrés'])} pad={false}>
            {data.payouts.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('c.date')}</th>
                      <th>{t(['الشركة', 'Transporteur'])}</th>
                      <th>{t(['الكشف', 'Relevé'])}</th>
                      <th>{t(['طلبيات', 'Cmd'])}</th>
                      <th className="text-end">{t(['المتوقع', 'Attendu'])}</th>
                      <th className="text-end">{t(['المستلم', 'Reçu'])}</th>
                      <th className="text-end">{t(['الفرق', 'Écart'])}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.payouts.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap text-xs">{dateOnly(p.received_on, lang)}</td>
                        <td>{name(p.carrier)}</td>
                        <td className="text-xs">{p.kind === 'opening' ? <Badge>{t(['رصيد افتتاحي', 'Solde d’ouverture'])}</Badge> : <span className="ltr">{p.reference || '—'}</span>}</td>
                        <td className="num">{n0(p.orders_count)}</td>
                        <td className="num text-end">{da(p.expected)}</td>
                        <td className="num text-end">{da(p.amount)}</td>
                        <td className="text-end">{p.kind === 'opening' ? '—' : <Badge tone={diffTone(p.diff)}>{da(p.diff)}</Badge>}</td>
                        <td className="whitespace-nowrap text-end">
                          <Button aria-label={t(['الطلبيات', 'Commandes'])} size="sm" variant="ghost" icon={Eye} onClick={() => setViewing(p)} />
                          <Button aria-label={t('c.delete')} size="sm" variant="ghost" icon={Trash2} loading={busy === `del:${p.id}`} onClick={() => run(`del:${p.id}`, () => api.del(`/collections/${p.id}`)).then((r) => r && reload(true))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={HandCoins} title={t(['لا دفعات مسجلة بعد', 'Aucun versement enregistré'])} />
            )}
          </Card>
        </>
      )}
      {paying && !isAll && <PayoutModal carrier={paying} onClose={() => setPaying(null)} onSaved={() => (setPaying(null), reload(true))} />}
      {opening && (
        <OpeningModal onClose={() => setOpening(false)} onSaved={() => (setOpening(false), reload(true))} />
      )}
      {viewing && <PayoutOrders payout={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
