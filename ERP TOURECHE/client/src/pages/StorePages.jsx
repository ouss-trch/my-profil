import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Globe, Package, Pencil, Pin, PinOff, Plus, RefreshCw, Split, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { n0, pct } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, Textarea, cx, useAction } from '../components/ui.jsx';

const KIND = {
  product: { label: ['منتج', 'Produit'], icon: Package },
  page: { label: ['صفحة', 'Page'], icon: FileText },
  url: { label: ['رابط خارجي', 'Lien externe'], icon: Globe },
};
const FILTERS = [
  ['pinned', ['المثبّتة', 'Épinglées']],
  ['all', ['الكل', 'Toutes']],
  ['product', ['المنتجات', 'Produits']],
  ['page', ['الصفحات', 'Pages']],
  ['url', ['روابط خارجية', 'Externes']],
];
const shortUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}${decodeURI(u.pathname)}${u.search}`;
  } catch {
    return url;
  }
};

function AddModal({ onClose, onSaved }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products');
  const [f, setF] = useState({ urls: '', product_id: '' });
  const count = f.urls.split(/\n+/).filter((x) => x.trim()).length;
  return (
    <Modal
      open
      onClose={onClose}
      title={t(['إضافة صفحات وتثبيتها', 'Ajouter et épingler des pages'])}
      footer={
        <Button variant="primary" loading={busy === 'add'} disabled={!count} onClick={() => run('add', () => api.post('/pages', { urls: f.urls, product_id: f.product_id || null }), { success: t([`ثُبّتت ${count} صفحة`, `${count} page(s) épinglée(s)`]) }).then((r) => r && onSaved())}>
          {t(['تثبيت', 'Épingler'])} {count > 0 ? `(${count})` : ''}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={t(['الروابط (رابط في كل سطر)', 'Liens (un par ligne)'])} hint={t(['روابط المتجر أو صفحات هبوط خارجية، ويمكن نسخة قالب مثل ?view=angle-gift', 'Liens de la boutique ou pages externes, y compris ?view=angle-gift'])}>
          <Textarea className="ltr min-h-[140px]" value={f.urls} onChange={(e) => setF({ ...f, urls: e.target.value })} placeholder={'https://souqnna.com/products/…\nhttps://souqnna.com/pages/…'} />
        </Field>
        <Field label={t(['المنتج (اختياري)', 'Produit (facultatif)'])}>
          <Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })} placeholder="—" options={(products.data || []).map((p) => ({ value: p.id, label: p.title }))} />
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ page, onClose, onSaved }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products');
  const [f, setF] = useState({ title: page.title || '', product_id: page.product_id || '', note: page.note || '' });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('c.edit')}
      footer={
        <Button variant="primary" loading={busy === 'save'} onClick={() => run('save', () => api.patch(`/pages/${page.id}`, { ...f, product_id: f.product_id || null })).then((r) => r && onSaved())}>
          {t('c.save')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label={t(['الاسم في الـ ERP', 'Nom dans l’ERP'])}>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t(['المنتج', 'Produit'])}>
          <Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })} placeholder="—" options={(products.data || []).map((p) => ({ value: p.id, label: p.title }))} />
        </Field>
        <Field label={t(['ملاحظة (الزاوية التسويقية، لمن الصفحة…)', 'Note (angle marketing, cible…)'])}>
          <Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export default function StorePages() {
  const { t } = useI18n();
  const { isAll } = useApp();
  const [filter, setFilter] = useState('pinned');
  const { data, error, loading, reload } = useApi('/pages');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const all = data?.rows || [];
  const rows = all.filter((p) => (filter === 'all' ? true : filter === 'pinned' ? p.pinned : p.kind === filter));
  const pinnedCount = all.filter((p) => p.pinned).length;
  const togglePin = (p) => run(`pin:${p.id}`, () => api.patch(`/pages/${p.id}`, { pinned: !p.pinned }), { success: false }).then((r) => r && reload(true));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Pin}
        title={t('nav.pages')}
        subtitle={t(['ثبّت الصفحات التي تستعملها في الإعلانات واختبارات A/B، وتابع طلبيات كل صفحة ونسبة تسليمها.', 'Épinglez les pages utilisées en pub et en A/B, et suivez commandes et livraison par page.'])}
        actions={
          <>
            <Button icon={RefreshCw} loading={busy === 'sync'} onClick={() => run('sync', () => api.post('/pages/sync', {}), { success: t(['تمت مزامنة صفحات المتجر', 'Pages synchronisées']) }).then((r) => r && reload(true))}>
              {t(['مزامنة من Shopify', 'Synchroniser Shopify'])}
            </Button>
            <Button variant="primary" icon={Plus} disabled={isAll} title={isAll ? t(['اختر مشروعاً أولاً', 'Choisissez un projet']) : undefined} onClick={() => setAdding(true)}>
              {t(['إضافة صفحات', 'Ajouter des pages'])}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" value={filter} onChange={setFilter} options={FILTERS.map(([v, l]) => ({ value: v, label: v === 'pinned' ? `${t(l)} (${pinnedCount})` : t(l) }))} />
        <p className="text-xs text-muted">{t(['الطلبيات تُنسب للصفحة من رابط الدخول (آخر 30 يوماً).', 'Commandes attribuées par page d’entrée (30 derniers jours).'])}</p>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !rows.length ? (
        <Card>
          <Empty
            icon={Pin}
            title={filter === 'pinned' ? t(['لا صفحات مثبّتة بعد', 'Aucune page épinglée']) : t(['لا صفحات', 'Aucune page'])}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={RefreshCw} onClick={() => run('sync', () => api.post('/pages/sync', {})).then((r) => r && reload(true))}>
                  {t(['مزامنة من Shopify', 'Synchroniser Shopify'])}
                </Button>
                {!isAll && (
                  <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                    {t(['إضافة صفحات', 'Ajouter des pages'])}
                  </Button>
                )}
              </div>
            }
          >
            {t(['المزامنة تجلب صفحات Shopify وصفحات المنتجات، أو الصق روابطك (رابط في كل سطر) فتُثبَّت مباشرة.', 'La synchro importe pages et produits Shopify, ou collez vos liens (un par ligne) : ils sont épinglés.'])}
          </Empty>
        </Card>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10" />
                  <th>{t(['الصفحة', 'Page'])}</th>
                  <th>{t(['المنتج', 'Produit'])}</th>
                  <th>{t(['طلبيات 30 يوماً', 'Commandes 30 j'])}</th>
                  <th>{t(['المسلّمة', 'Livrées'])}</th>
                  <th>A/B</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const K = KIND[p.kind] || KIND.url;
                  return (
                    <tr key={p.id}>
                      <td>
                        <button
                          type="button"
                          className={cx('btn btn-ghost h-9 w-9 p-0', p.pinned ? 'text-brand' : 'text-muted')}
                          aria-pressed={Boolean(p.pinned)}
                          aria-label={p.pinned ? t(['إلغاء التثبيت', 'Désépingler']) : t(['تثبيت', 'Épingler'])}
                          title={p.pinned ? t(['إلغاء التثبيت', 'Désépingler']) : t(['تثبيت', 'Épingler'])}
                          disabled={busy === `pin:${p.id}`}
                          onClick={() => togglePin(p)}
                        >
                          {p.pinned ? <Pin className="h-4 w-4 fill-current" /> : <PinOff className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="min-w-[16rem]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium" dir="auto">{p.title || shortUrl(p.url)}</span>
                          <Badge icon={K.icon}>{t(K.label)}</Badge>
                          {!p.published && <Badge tone="warn">{t(['غير منشورة', 'Non publiée'])}</Badge>}
                          {p.gone ? <Badge tone="bad">{t(['حُذفت من المتجر', 'Supprimée de la boutique'])}</Badge> : null}
                        </div>
                        <a href={p.url} target="_blank" rel="noreferrer" className="ltr mt-0.5 block max-w-md truncate text-xs text-muted hover:text-ink">
                          {shortUrl(p.url)}
                        </a>
                        {p.note && <div className="mt-0.5 text-xs text-sub">{p.note}</div>}
                      </td>
                      <td>{p.product_id ? <Link className="link" to={`/products/${p.product_id}`}>{p.product_title}</Link> : <span className="text-muted">—</span>}</td>
                      <td className="num">{n0(p.orders_30d)}</td>
                      <td className="num">
                        {n0(p.delivered_30d)}
                        {p.delivery_rate !== null && <span className="text-xs text-muted"> · {pct(p.delivery_rate)}</span>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {p.tests.length ? (
                            p.tests.map((x) => (
                              <Link key={x.id} to={`/splits/${x.id}`} className="chip bg-info/10 text-info">
                                <Split className="h-3 w-3" />
                                {x.name}
                              </Link>
                            ))
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <CopyButton text={p.url} />
                          <a className="btn btn-ghost btn-sm" href={p.url} target="_blank" rel="noreferrer" aria-label={t(['فتح الصفحة', 'Ouvrir la page'])} title={t(['فتح الصفحة', 'Ouvrir la page'])}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('c.edit')} onClick={() => setEditing(p)} />
                          {(!p.synced_at || Boolean(p.gone)) && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('c.delete')} onClick={() => run('del', () => api.del(`/pages/${p.id}`)).then((r) => r && reload(true))} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {adding && (
        <AddModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setFilter('pinned');
            reload(true);
          }}
        />
      )}
      {editing && (
        <EditModal
          page={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload(true);
          }}
        />
      )}
    </div>
  );
}
