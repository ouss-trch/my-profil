import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ImageOff, LayoutGrid, List, Package, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced, useLocalStorage } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { da, n0 } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, useAction } from '../components/ui.jsx';
import { LaunchButton } from '../components/LaunchCampaign.jsx';

export const STAGES = {
  idea: ['فكرة', 'Idée', 'neutral'],
  draft: ['مسودة', 'Brouillon', 'neutral'],
  ready: ['جاهز', 'Prêt', 'info'],
  published: ['منشور', 'Publié', 'good'],
  archived: ['مؤرشف', 'Archivé', 'neutral'],
};
export const TEST_STAGES = {
  none: ['بلا اختبار', 'Sans test', 'neutral'],
  idea: ['فكرة', 'Idée', 'neutral'],
  preparing: ['تحضير', 'Préparation', 'info'],
  testing: ['قيد الاختبار', 'En test', 'purple'],
  winner: ['رابح', 'Gagnant', 'good'],
  loser: ['خاسر', 'Perdant', 'bad'],
  paused: ['متوقف', 'En pause', 'warn'],
};
export const seoTone = (s) => (s === null || s === undefined ? 'neutral' : s >= 80 ? 'good' : s >= 60 ? 'warn' : 'bad');

export default function Products() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { isAll } = useApp();
  const [params] = useSearchParams();
  const filter = params.get('filter');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [stage, setStage] = useState('');
  const [view, setView] = useLocalStorage('erp.products.view', 'grid');
  const [lowOnly, setLowOnly] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const { run, busy } = useAction();
  const { data, error, loading, reload } = useApi(`/products${qs({ q: dq, stage, low_stock: lowOnly ? '1' : '' })}`);
  useEffect(() => {
    const h = () => reload(true);
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
  }, [reload]);
  const rows = useMemo(() => {
    let r = data || [];
    if (filter === 'seo') r = r.filter((p) => p.shopify_id && (p.seo_score ?? 0) < 60);
    if (filter === 'no_cost') r = r.filter((p) => !p.cost_price);
    if (filter === 'dead') r = r.filter((p) => p.stock > 0);
    return r;
  }, [data, filter]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Package}
        title={t('nav.products')}
        subtitle={t(['كل منتجات المتجر والمنتجات قيد الإنشاء — لكل منتج: تعديل، SEO، صور وإعلان', 'Tous les produits (boutique et en création) — édition, SEO, visuels et pub'])}
        actions={
          <>
            <Button icon={RefreshCw} loading={busy === 'sync'} onClick={() => run('sync', () => api.post('/products/sync', {}), { success: t(['تمت مزامنة المنتجات من Shopify', 'Produits synchronisés depuis Shopify']) }).then(() => reload(true))}>
              {t(['مزامنة Shopify', 'Sync Shopify'])}
            </Button>
            <Button variant="primary" icon={Plus} disabled={isAll} title={isAll ? t('c.selectProject') : undefined} onClick={() => setNewOpen(true)}>
              {t(['منتج جديد', 'Nouveau produit'])}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(['اسم، رابط، SKU، وسم…', 'Nom, handle, SKU, tag…'])} />
        <Select className="w-auto" value={stage} onChange={(e) => setStage(e.target.value)} placeholder={t(['كل المراحل', 'Toutes les étapes'])} options={Object.entries(STAGES).map(([k, v]) => ({ value: k, label: t(v) }))} />
        <Button size="sm" variant={lowOnly ? 'primary' : undefined} onClick={() => setLowOnly(!lowOnly)}>
          {t(['مخزون منخفض', 'Stock faible'])}
        </Button>
        {filter && (
          <Badge tone="brand">
            {filter === 'seo' ? t(['SEO ضعيف', 'SEO faible']) : filter === 'no_cost' ? t(['دون سعر تكلفة', 'Sans coût']) : t(['مخزون راكد', 'Stock dormant'])}{' '}
            <Link to="/products" className="ms-1">
              ✕
            </Link>
          </Badge>
        )}
        <span className="flex-1" />
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: <LayoutGrid className="h-4 w-4" /> },
            { value: 'list', label: <List className="h-4 w-4" /> },
          ]}
        />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !rows.length ? (
        <Card>
          <Empty icon={Package} title={t(['لا منتجات', 'Aucun produit'])}>
            {t(['زامن منتجاتك من Shopify أو أنشئ منتجاً جديداً.', 'Synchronisez Shopify ou créez un produit.'])}
          </Empty>
        </Card>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((p) => (
            <article key={p.id} className="card flex flex-col overflow-hidden">
              <Link to={`/products/${p.id}`} className="relative block aspect-[4/3] bg-raised">
                {p.images?.[0]?.url ? (
                  <img src={p.images[0].url} alt={p.images[0].alt || p.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-full items-center justify-center text-muted">
                    <ImageOff className="h-8 w-8" />
                  </span>
                )}
                <span className="absolute start-2 top-2 flex flex-wrap gap-1">
                  <Badge tone={STAGES[p.stage]?.[2]}>{t(STAGES[p.stage] || [p.stage, p.stage])}</Badge>
                  {p.test_stage && p.test_stage !== 'none' && p.test_stage !== 'idea' && <Badge tone={TEST_STAGES[p.test_stage]?.[2]}>{t(TEST_STAGES[p.test_stage])}</Badge>}
                </span>
              </Link>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <Link to={`/products/${p.id}`} className="line-clamp-2 text-sm font-semibold leading-6 hover:text-brand-ink">
                  {p.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{da(p.price)}</span>
                  {p.compare_at_price > p.price && <span className="text-muted line-through">{da(p.compare_at_price)}</span>}
                  <Badge tone={p.stock !== null && p.stock <= p.low_stock ? 'bad' : 'neutral'}>
                    {t('c.stock')}: {p.stock === null ? '∞' : n0(p.stock)}
                  </Badge>
                  <Badge tone={seoTone(p.seo_score)}>SEO {p.seo_score ?? '—'}</Badge>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" icon={Pencil} onClick={() => nav(`/products/${p.id}`)}>
                    {t('c.edit')}
                  </Button>
                  <LaunchButton product={p} onDone={() => reload(true)} />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('c.product')}</th>
                  <th className="text-end">{t('c.price')}</th>
                  <th className="text-end">{t(['التكلفة', 'Coût'])}</th>
                  <th className="text-end">{t('c.stock')}</th>
                  <th>{t(['المرحلة', 'Étape'])}</th>
                  <th>{t(['الاختبار', 'Test'])}</th>
                  <th>SEO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/products/${p.id}`} className="flex items-center gap-2">
                        {p.images?.[0]?.url ? <img src={p.images[0].url} alt="" className="h-9 w-9 rounded object-cover" loading="lazy" /> : <span className="h-9 w-9 rounded bg-raised" />}
                        <span className="link font-medium">{p.title}</span>
                      </Link>
                    </td>
                    <td className="num text-end">{da(p.price)}</td>
                    <td className="num text-end text-sub">{p.cost_price ? da(p.cost_price) : <Badge tone="warn">—</Badge>}</td>
                    <td className="num text-end">{p.stock === null ? '∞' : <span className={p.stock <= p.low_stock ? 'text-bad' : ''}>{n0(p.stock)}</span>}</td>
                    <td>
                      <Badge tone={STAGES[p.stage]?.[2]}>{t(STAGES[p.stage] || [p.stage, p.stage])}</Badge>
                    </td>
                    <td>
                      <Badge tone={TEST_STAGES[p.test_stage]?.[2]}>{t(TEST_STAGES[p.test_stage] || ['—', '—'])}</Badge>
                    </td>
                    <td>
                      <Badge tone={seoTone(p.seo_score)}>{p.seo_score ?? '—'}</Badge>
                    </td>
                    <td>
                      <LaunchButton product={p} label="" onDone={() => reload(true)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <NewProductModal
        open={newOpen}
        onClose={(id) => {
          setNewOpen(false);
          if (id) nav(`/products/${id}`);
        }}
      />
    </div>
  );
}

function NewProductModal({ open, onClose }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [f, setF] = useState({ title: '', price: '', cost_price: '', stock: '', notes: '' });
  useEffect(() => {
    if (open) setF({ title: '', price: '', cost_price: '', stock: '', notes: '' });
  }, [open]);
  const save = async () => {
    const r = await run('save', () =>
      api.post('/products', {
        title: f.title,
        price: f.price === '' ? null : Number(f.price),
        cost_price: f.cost_price === '' ? null : Number(f.cost_price),
        stock: f.stock === '' ? null : Number(f.stock),
        notes: f.notes,
        stage: 'draft',
        test_stage: 'preparing',
      }),
    );
    if (r) onClose(r.id);
  };
  return (
    <Modal
      open={open}
      onClose={() => onClose(null)}
      title={t(['منتج جديد', 'Nouveau produit'])}
      icon={Plus}
      footer={
        <Button variant="primary" loading={busy === 'save'} disabled={!f.title.trim()} onClick={save}>
          {t(['إنشاء ومتابعة التحرير', 'Créer et continuer'])}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t(['اسم المنتج', 'Nom du produit'])} className="sm:col-span-3">
          <Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t(['سعر البيع (دج)', 'Prix de vente (DA)'])}>
          <Input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
        <Field label={t(['سعر الشراء (دج)', "Prix d'achat (DA)"])}>
          <Input type="number" value={f.cost_price} onChange={(e) => setF({ ...f, cost_price: e.target.value })} />
        </Field>
        <Field label={t('c.stock')}>
          <Input type="number" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} />
        </Field>
        <Field label={t(['المعلومات التقنية (المادة، المقاسات، السعة…)', 'Infos techniques (matière, dimensions, capacité…)'])} className="sm:col-span-3" hint={t(['تُستعمل لتوليد صفحة SEO والنصوص الإعلانية بالذكاء الاصطناعي', 'Utilisées pour générer le SEO et les textes pub par IA'])}>
          <textarea className="input min-h-[100px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
