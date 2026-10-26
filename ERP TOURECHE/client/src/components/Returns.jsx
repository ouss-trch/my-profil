import { useState } from 'react';
import { PackageCheck, RefreshCw, Undo2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { da, dateOnly } from '../lib/format.js';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, Select, cx, useAction, useToast } from './ui.jsx';

const WHY = {
  not_deducted: ['لم يُخصم من أي مخزون عند البيع (طلبية خارج Shopify): لا شيء يُعاد', 'Jamais déduit à la vente (hors Shopify) : rien à remettre'],
  no_variant: ['سطر بلا منتج Shopify: لا مخزون يُعاد', 'Ligne sans variante Shopify : rien à remettre'],
  untracked: ['المخزون غير متتبَّع في Shopify', 'Stock non suivi dans Shopify'],
};
const LOSS = [
  ['damaged', ['تالف', 'Endommagé']],
  ['missing', ['مفقود', 'Manquant']],
];

function ShopifyState({ r, onRetry, busy }) {
  const { t } = useI18n();
  if (r.state === 'reversed') return <Badge>{t(['أُلغي الإرجاع: سُحب ما أُعيد', 'Retour annulé : stock retiré'])}</Badge>;
  if (r.shopify_state === 'done') return <Badge tone="good">{t(['عاد إلى مخزون Shopify', 'Remis en stock Shopify'])}</Badge>;
  if (r.shopify_state === 'pending') return <Badge tone="info">{t(['قيد الإرسال إلى Shopify', 'Envoi à Shopify en cours'])}</Badge>;
  if (r.shopify_state === 'failed')
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone="bad" title={r.shopify_error || ''}>
          {t(['لم يصل إلى Shopify', 'Non transmis à Shopify'])}
        </Badge>
        <Button size="sm" icon={RefreshCw} loading={busy} onClick={onRetry}>
          {t(['إعادة المحاولة', 'Réessayer'])}
        </Button>
      </span>
    );
  return <Badge>{t(['لا مخزون Shopify معني', 'Pas de stock Shopify concerné'])}</Badge>;
}

/** بطاقة المرتجع في درج الطلبية: ما عاد صالحاً، وما تلف أو ضاع، وحالة مخزون Shopify، والكلفة */
export function ReturnCard({ order, onChanged }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const r = order.return;
  const [edit, setEdit] = useState(null);
  if (!r) {
    if (order.status !== 'returned') return null;
    return (
      <Card title={t(['المرتجع', 'Retour'])} icon={Undo2}>
        <p className="text-sm text-sub">{t(['مرتجعة قديمة سبقت دفتر المرتجعات: عالجها من تبويب «مرتجعة».', 'Ancien retour, antérieur au registre : traitez-le depuis l’onglet « Retournées ».'])}</p>
      </Card>
    );
  }
  const items = edit || r.items;
  const set = (idx, patch) => setEdit(items.map((i) => (i.idx === idx ? { ...i, ...patch } : i)));
  const valid = items.every((i) => i.back === i.qty || LOSS.some(([k]) => k === i.loss));
  const fee = r.return_fee;
  const save = () =>
    run('ret', () => api.patch(`/returns/${r.id}`, { items: items.map((i) => ({ idx: i.idx, back: i.back, loss: i.back < i.qty ? i.loss : null })) }), {
      success: t(['حُفظت حالة المرتجع', 'Retour mis à jour']),
    }).then((x) => {
      if (!x) return;
      setEdit(null);
      onChanged();
    });
  return (
    <Card title={t(['المرتجع', 'Retour'])} icon={Undo2} actions={<ShopifyState r={r} busy={busy === 'retry'} onRetry={() => run('retry', () => api.post(`/returns/${r.id}/retry`, {}), { success: false }).then((x) => x && onChanged())} />}>
      <div className="space-y-3 text-sm">
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.idx} className="rounded-lg bg-raised px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 font-medium" dir="auto">
                  {i.qty}× {i.title}
                  {i.variant ? <span className="text-muted"> · {i.variant}</span> : null}
                </span>
                {r.state === 'open' && (
                  <span className="flex items-center gap-2">
                    <label className="text-xs text-sub" htmlFor={`back-${r.id}-${i.idx}`}>
                      {t(['عاد صالحاً', 'Revenu en bon état'])}
                    </label>
                    <Input id={`back-${r.id}-${i.idx}`} type="number" inputMode="numeric" min="0" max={i.qty} className="w-16" value={i.back} onChange={(e) => set(i.idx, { back: Math.max(0, Math.min(i.qty, Number(e.target.value) || 0)) })} />
                    {i.back < i.qty && (
                      <Select aria-label={t(['سبب النقص', 'Motif'])} className="w-auto" value={i.loss || ''} onChange={(e) => set(i.idx, { loss: e.target.value })} placeholder={t(['السبب', 'Motif'])} options={LOSS.map(([v, l]) => ({ value: v, label: t(l) }))} />
                    )}
                  </span>
                )}
              </div>
              {i.why && WHY[i.why] && <p className="mt-1 text-xs text-muted">{t(WHY[i.why])}</p>}
              {r.state === 'open' && !i.why && i.restock > 0 && <p className="mt-1 text-xs text-good">{t([`+${i.restock} إلى المخزون`, `+${i.restock} en stock`])}</p>}
            </li>
          ))}
        </ul>
        {edit && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {t('c.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={!valid} loading={busy === 'ret'} onClick={save}>
              {t('c.save')}
            </Button>
          </div>
        )}
        {r.state === 'open' && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">{t(['سعر الإرجاع', 'Frais de retour'])}</dt>
            <dd className={cx('num text-end', fee === null && 'text-warn')} title={fee === null ? t(['غير معروف: حدّث أسعار شركة التوصيل', 'Inconnu : mettez à jour les tarifs']) : undefined}>
              {fee === null ? t(['غير معروف', 'Inconnu']) : da(fee)}
            </dd>
            <dt className="text-muted">{t(['تغليف ضائع', 'Emballage perdu'])}</dt>
            <dd className="num text-end">{da(r.packaging_lost)}</dd>
            <dt className="text-muted">{t(['بضاعة تالفة أو مفقودة', 'Marchandise perdue'])}</dt>
            <dd className={cx('num text-end', r.goods_lost > 0 && 'text-bad')}>{da(r.goods_lost)}</dd>
            <dt className="font-medium">{t(['كلفة هذا المرتجع', 'Coût de ce retour'])}</dt>
            <dd className="num text-end font-semibold">{da((fee || 0) + r.packaging_lost + r.goods_lost)}</dd>
          </dl>
        )}
        {r.shopify_state === 'failed' && r.shopify_error && (
          <p className="text-xs text-bad">
            {/access_denied|access denied|write_inventory/i.test(r.shopify_error)
              ? t(['تطبيق Shopify لا يملك صلاحية write_inventory: أضفها في Dev Dashboard ثم أعد المحاولة.', 'L’app Shopify n’a pas le scope write_inventory : ajoutez-le puis réessayez.'])
              : r.shopify_error === 'shopify_not_configured'
                ? t(['Shopify غير مربوط بهذا المشروع: أضف بياناته في الإعدادات.', 'Shopify n’est pas connecté à ce projet : voir Paramètres.'])
                : r.shopify_error}
          </p>
        )}
      </div>
    </Card>
  );
}

function LegacyModal({ onClose, onDone }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const { data, error, loading } = useApi('/returns/legacy');
  const rows = data || [];
  const [sel, setSel] = useState(null);
  const chosen = sel || new Set(rows.map((o) => o.id));
  const allSel = rows.length > 0 && chosen.size === rows.length;
  const go = (alreadyRestocked) =>
    run(alreadyRestocked ? 'manual' : 'now', () => api.post('/returns/legacy', { order_ids: [...chosen], already_restocked: alreadyRestocked }), { success: false }).then((r) => r && onDone(r.processed));
  return (
    <Modal
      open
      size="lg"
      icon={PackageCheck}
      onClose={onClose}
      title={t(['مرتجعات قديمة لم تُعالَج في المخزون', 'Anciens retours non traités en stock'])}
      footer={
        <>
          <Button loading={busy === 'manual'} disabled={!chosen.size} onClick={() => go(true)}>
            {t(['سبق أن أعدتها يدوياً', 'Déjà remis à la main'])}
          </Button>
          <Button variant="primary" loading={busy === 'now'} disabled={!chosen.size} onClick={() => go(false)}>
            {t(['أعِدها إلى المخزون الآن', 'Remettre en stock maintenant']) + ` (${chosen.size})`}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-sub">
        {t([
          'هذه الطلبيات أصبحت «مرتجعة» قبل دفتر المرتجعات. إن كنت أعدت بضاعتها يدوياً في Shopify فاختر «سبق أن أعدتها»، وإلا «أعِدها الآن». في الحالتين تُحسب كلفتها في المالية والإعلانات.',
          'Ces commandes sont revenues avant le registre. Si vous les avez remises en stock dans Shopify, choisissez « Déjà remis », sinon « Remettre maintenant ». Leur coût est compté dans tous les cas.',
        ])}
      </p>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !rows.length ? (
        <Empty icon={PackageCheck} title={t(['لا مرتجعات قديمة', 'Aucun ancien retour'])} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((o) => o.id)))} aria-label={t(['تحديد الكل', 'Tout sélectionner'])} />
                </th>
                <th>{t(['الطلبية', 'Commande'])}</th>
                <th>{t(['المنتجات', 'Produits'])}</th>
                <th>{t(['أُرجعت', 'Retournée'])}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={chosen.has(o.id)}
                      onChange={() => setSel(new Set(chosen.has(o.id) ? [...chosen].filter((x) => x !== o.id) : [...chosen, o.id]))}
                      aria-label={`${t(['تحديد', 'Sélectionner'])} ${o.number}`}
                    />
                  </td>
                  <td>
                    <span className="num font-medium">{o.number}</span>
                    {!o.shopify && <Badge className="ms-1.5">{t(['خارج Shopify', 'Hors Shopify'])}</Badge>}
                    <div className="text-xs text-muted">{o.customer_name}</div>
                  </td>
                  <td className="text-xs" dir="auto">
                    {o.items}
                  </td>
                  <td className="whitespace-nowrap text-xs">{dateOnly(o.returned_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** شريط تبويب «مرتجعة»: ما ينتظر Shopify، ما فشل، القديمة، وخسارة البضاعة */
export function ReturnsBar({ onChanged }) {
  const { t } = useI18n();
  const { data, reload } = useApi('/returns/summary');
  const [legacy, setLegacy] = useState(false);
  const toast = useToast();
  if (!data) return null;
  const quiet = !data.pending && !data.failed && !data.legacy;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <PackageCheck className="h-4 w-4 shrink-0 text-brand" />
      {quiet ? (
        <span className="min-w-0 flex-1 text-sub">{t(['كل طرد يعود إلى البائع يرجع تلقائياً إلى مخزون Shopify والـ ERP. افتح الطلبية لتعليم قطعة تالفة أو مفقودة.', 'Chaque colis revenu est remis en stock dans Shopify et l’ERP. Ouvrez la commande pour signaler une pièce endommagée ou manquante.'])}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {data.pending > 0 && <Badge tone="info">{t([`${data.pending} قيد الإرسال إلى Shopify`, `${data.pending} en cours vers Shopify`])}</Badge>}
          {data.failed > 0 && (
            <Badge tone="bad" title={data.last_error || ''}>
              {t([`${data.failed} لم تصل إلى Shopify`, `${data.failed} non transmis à Shopify`])}
            </Badge>
          )}
          {data.legacy > 0 && (
            <Button size="sm" variant="primary" icon={PackageCheck} onClick={() => setLegacy(true)}>
              {t([`معالجة المرتجعات القديمة (${data.legacy})`, `Traiter les anciens retours (${data.legacy})`])}
            </Button>
          )}
        </span>
      )}
      {data.lost_30d > 0 && <Badge tone="warn">{t([`بضاعة ضائعة 30 يوماً: ${da(data.lost_30d)}`, `Marchandise perdue 30 j : ${da(data.lost_30d)}`])}</Badge>}
      {legacy && (
        <LegacyModal
          onClose={() => setLegacy(false)}
          onDone={(n) => {
            setLegacy(false);
            toast.ok(t([`عولجت ${n} طلبية`, `${n} commandes traitées`]));
            reload(true);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
