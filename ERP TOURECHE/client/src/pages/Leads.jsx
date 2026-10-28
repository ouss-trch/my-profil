import { useEffect, useState } from 'react';
import { CheckCircle2, MessageSquare, PhoneCall, ShoppingCart, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { ago, da } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Pagination, Stat, useAction } from '../components/ui.jsx';
import { OrderDrawer, itemsText } from './Orders.jsx';
import BulkDelete from '../components/BulkDelete.jsx';
import { useApp } from '../components/ProjectContext.jsx';

/** السلات المتروكة: زبون ترك رقمه دون إكمال الطلب — أرخص طلبيات يمكن استرجاعها */
export default function Leads() {
  const { t, lang } = useI18n();
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const { auth } = useApp();
  const admin = auth.user?.role === 'admin';
  const { run, busy } = useAction();
  const { data, error, loading, reload } = useApi(`/orders${qs({ status: 'abandoned', limit: 50, offset, sort: 'newest' })}`);
  useEffect(() => {
    const h = () => reload(true);
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
  }, [reload]);
  const rows = data?.rows || [];
  const value = rows.reduce((s, o) => s + o.total, 0);
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
  useEffect(() => setSelected(new Set()), [offset]);
  const toggle = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };
  const move = async (o, to) => {
    const r = await run(`${o.id}:${to}`, () => api.post(`/orders/${o.id}/status`, { status: to, note: 'lead recovered' }), { success: false });
    if (r) reload(true);
  };
  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShoppingCart}
        title={t('nav.leads')}
        subtitle={t(['زبائن تركوا أرقامهم دون إكمال الطلب — اتصل بهم بعرض صغير لاسترجاعهم', 'Clients ayant laissé leur numéro sans finaliser — rappelez-les avec une petite offre'])}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t(['سلات مفتوحة', 'Paniers ouverts'])} value={data?.total ?? '—'} icon={ShoppingCart} />
        <Stat label={t(['قيمتها (هذه الصفحة)', 'Valeur (cette page)'])} value={da(value)} />
        <Stat label={t(['لم يُتصل بها', 'Jamais rappelés'])} value={rows.filter((o) => !o.call_attempts).length} tone="warn" />
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand/5 px-3 py-1.5 text-sm">
          <span className="font-medium">{t(['{n} محددة', '{n} sélectionnées'], { n: selected.size })}</span>
          <BulkDelete
            count={selected.size}
            all={allSel}
            label={t(['حذف {n} سلة', 'Supprimer {n} panier(s)'], { n: selected.size })}
            allLabel={t(['ستحذف كل السلات المعروضة', 'Vous allez supprimer tous les paniers affichés'])}
            points={[
              t(['تُحذف هذه السلات المتروكة من الـ ERP نهائياً.', 'Ces paniers abandonnés sont supprimés définitivement de l’ERP.']),
              t(['لن تعيدها مزامنة الجدول ولا n8n.', 'Ni la synchro du Sheet ni n8n ne les feront revenir.']),
              t(['إن أكمل الزبون طلبه لاحقاً في Shopify تصل طلبيته الجديدة عادياً.', 'Si le client finalise plus tard dans Shopify, sa nouvelle commande arrive normalement.']),
            ]}
            run={() => api.post('/orders/bulk/delete', { ids: [...selected] }, { reason: t(['أدخل كلمة المرور الحساسة لحذف {n} سلة', 'Mot de passe sensible pour supprimer {n} panier(s)'], { n: selected.size }) })}
            done={(r) => t(['حُذفت {n} سلة', '{n} panier(s) supprimé(s)'], { n: r.deleted })}
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
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {admin && (
                    <th className="w-8">
                      <input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label={t(['تحديد الكل', 'Tout sélectionner'])} />
                    </th>
                  )}
                  <th>{t(['الزبون', 'Client'])}</th>
                  <th>{t('c.wilaya')}</th>
                  <th>{t('c.products')}</th>
                  <th className="text-end">{t('c.total')}</th>
                  <th>{t('c.date')}</th>
                  <th>{t('c.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={selected.has(o.id) ? 'bg-brand/5' : undefined}>
                    {admin && (
                      <td>
                        <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={o.customer_name || o.phone || String(o.id)} />
                      </td>
                    )}
                    <td>
                      <button type="button" className="link font-medium" onClick={() => setOpenId(o.id)}>
                        {o.customer_name || '—'}
                      </button>
                      <div className="flex items-center gap-2 text-xs">
                        <a className="ltr link" href={`tel:${o.phone}`}>
                          {o.phone}
                        </a>
                        {o.call_attempts > 0 && <Badge tone="warn">☎ {o.call_attempts}</Badge>}
                      </div>
                    </td>
                    <td className="text-xs">{o.wilaya ? (lang === 'ar' ? o.wilaya.ar : o.wilaya.fr) : '—'}</td>
                    <td className="max-w-[18rem] truncate text-xs">{itemsText(o.items)}</td>
                    <td className="num text-end">{da(o.total)}</td>
                    <td className="text-xs text-muted">{ago(o.created_at, lang)}</td>
                    <td>
                      <div className="flex gap-1">
                        <a className="btn btn-sm" href={`tel:${o.phone}`} title={t(['اتصال', 'Appeler'])}>
                          <PhoneCall className="h-3.5 w-3.5" />
                        </a>
                        <a className="btn btn-sm" href={`https://wa.me/213${String(o.phone || '').replace(/^0/, '')}`} target="_blank" rel="noreferrer" title="WhatsApp">
                          <MessageSquare className="h-3.5 w-3.5" />
                        </a>
                        <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy === `${o.id}:confirmed`} onClick={() => move(o, 'confirmed')}>
                          {t(['تأكيد', 'Confirmer'])}
                        </Button>
                        <Button size="sm" onClick={() => move(o, 'no_answer')} loading={busy === `${o.id}:no_answer`}>
                          {t(['لا يرد', 'Sans réponse'])}
                        </Button>
                        <Button aria-label={t(['إلغاء الطلبية', 'Annuler la commande'])} size="sm" variant="ghost" icon={XCircle} onClick={() => move(o, 'cancelled')} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={ShoppingCart} title={t(['لا سلات متروكة', 'Aucun panier abandonné'])} />
        )}
        {data && <Pagination total={data.total} limit={50} offset={offset} onChange={setOffset} />}
      </Card>
      <OrderDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => reload(true)} />
    </div>
  );
}
