import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  ImagePlus,
  Megaphone,
  Package,
  Plus,
  Rocket,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { da, money, n0, pct } from '../lib/format.js';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Bar, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Stat, Tabs, Textarea, Toggle, cx, useAction } from '../components/ui.jsx';
import LaunchCampaign from '../components/LaunchCampaign.jsx';
import ProductQuestions from '../components/ProductQuestions.jsx';
import VariantsEditor from '../components/VariantsEditor.jsx';
import { STAGES, TEST_STAGES, seoTone } from './Products.jsx';

const SEO_LABELS = {
  focus_keyword: ['الكلمة المفتاحية محددة', 'Mot-clé principal défini'],
  title_length: ['طول عنوان المنتج (20–80)', 'Longueur du titre (20–80)'],
  seo_title_length: ['طول عنوان SEO (35–65)', 'Longueur du titre SEO (35–65)'],
  kw_in_seo_title: ['الكلمة المفتاحية في عنوان SEO', 'Mot-clé dans le titre SEO'],
  kw_at_title_start: ['الكلمة في بداية العنوان', 'Mot-clé en début de titre'],
  seo_description_length: ['طول وصف SEO (120–165)', 'Longueur de la méta-description (120–165)'],
  kw_in_seo_description: ['الكلمة في وصف SEO', 'Mot-clé dans la méta-description'],
  handle_clean: ['رابط نظيف بالحروف اللاتينية', 'URL propre en latin'],
  kw_in_handle: ['الكلمة في الرابط', "Mot-clé dans l'URL"],
  kw_in_first_100_words: ['الكلمة في أول 100 كلمة', 'Mot-clé dans les 100 premiers mots'],
  description_depth: ['وصف عميق (250 كلمة+)', 'Description riche (250 mots+)'],
  no_h1_in_description: ['لا H1 داخل الوصف', 'Pas de H1 dans la description'],
  headings_structure: ['عناوين فرعية H2/H3', 'Sous-titres H2/H3'],
  has_bullets: ['قائمة مميزات', 'Liste à puces'],
  has_specs: ['جدول المواصفات', 'Tableau des caractéristiques'],
  has_faq: ['أسئلة شائعة', 'FAQ'],
  keyword_density: ['كثافة الكلمة معتدلة', 'Densité du mot-clé'],
  images_count: ['4 صور أو أكثر', '4 images ou plus'],
  images_alt: ['نص بديل لكل صورة', 'Texte alternatif sur chaque image'],
  kw_in_alt: ['الكلمة في نص الصور', 'Mot-clé dans un alt'],
  unique_seo_title: ['عنوان SEO غير مكرر', 'Titre SEO unique'],
  unique_handle: ['رابط غير مكرر', 'URL unique'],
  product_type: ['نوع المنتج', 'Type de produit'],
  tags: ['3–20 وسماً', '3–20 tags'],
  collection: ['داخل مجموعة', 'Dans une collection'],
  price_logic: ['السعر قبل التخفيض أكبر', 'Prix barré cohérent'],
};
const EDIT_KEYS = ['title', 'handle', 'stage', 'product_type', 'vendor', 'description_html', 'seo_title', 'seo_description', 'focus_keyword', 'price', 'compare_at_price', 'cost_price', 'packaging_cost', 'low_stock', 'sku', 'notes', 'audience', 'tags', 'collections', 'images', 'specs', 'angles', 'options', 'variants', 'test_stage', 'test_budget_da', 'decision_note', 'supplier', 'supplier_url', 'supplier_id', 'category_id', 'category_name'];
const LIST_KEYS = ['tags', 'collections', 'images', 'specs', 'angles', 'options', 'variants'];
const num = (x) => (x === '' || x === null || x === undefined ? null : Number(x));

export default function ProductEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t } = useI18n();
  const { data: p, error, loading, reload, setData } = useApi(`/products/${id}`);
  const [f, setF] = useState(null);
  const [tab, setTab] = useState('product');
  const [launch, setLaunch] = useState(false);
  const [remove, setRemove] = useState(false);
  const { run, busy } = useAction();
  useEffect(() => {
    if (p) setF(Object.fromEntries(EDIT_KEYS.map((k) => [k, p[k] ?? (LIST_KEYS.includes(k) ? [] : '')])));
  }, [p]);
  const dirty = useMemo(() => (p && f ? EDIT_KEYS.filter((k) => JSON.stringify(f[k] ?? '') !== JSON.stringify(p[k] ?? (LIST_KEYS.includes(k) ? [] : ''))) : []), [p, f]);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!f) return <Loading />;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const save = async () => {
    const body = {};
    for (const k of dirty) body[k] = ['price', 'compare_at_price', 'cost_price', 'packaging_cost', 'low_stock', 'test_budget_da'].includes(k) ? (f[k] === '' ? null : Number(f[k])) : f[k];
    // المتغيرات: أرقام حقيقية (السعر الفارغ = سعر المنتج، المخزون الفارغ = غير محدد)
    if (body.variants) body.variants = body.variants.map((v) => ({ ...v, price: num(v.price) ?? num(f.price), compare_at_price: num(v.compare_at_price), stock: num(v.stock) }));
    const r = await run('save', () => api.patch(`/products/${p.id}`, body, { project: p.project_id }));
    if (r) setData({ ...p, ...r, break_even: p.break_even });
  };
  const storeUrl = p.online_url || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => nav('/products')}>
          <ArrowRight className="h-4 w-4 ltr:rotate-180" />
          {t('c.back')}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{p.title}</h1>
        <Badge tone={STAGES[p.stage]?.[2]}>{t(STAGES[p.stage] || [p.stage, p.stage])}</Badge>
        <Badge tone={seoTone(p.seo_score)}>SEO {p.seo_score ?? '—'}</Badge>
        {storeUrl && (
          <a className="btn btn-sm" href={storeUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            {t(['في المتجر', 'Boutique'])}
          </a>
        )}
        <Button size="sm" icon={Rocket} onClick={() => setLaunch(true)}>
          {t(['إطلاق حملة', 'Lancer une campagne'])}
        </Button>
        <Button variant="primary" icon={Save} loading={busy === 'save'} disabled={!dirty.length} onClick={save}>
          {t('c.save')} {dirty.length ? `(${dirty.length})` : ''}
        </Button>
        {p.stage !== 'archived' && (
          <Button size="sm" variant="ghost" icon={p.shopify_id ? Archive : Trash2} onClick={() => setRemove(true)}>
            {p.shopify_id ? t(['أرشفة', 'Archiver']) : t('c.delete')}
          </Button>
        )}
      </div>
      <Modal
        open={remove}
        onClose={() => setRemove(false)}
        icon={p.shopify_id ? Archive : Trash2}
        title={p.shopify_id ? t(['أرشفة «{x}»؟', 'Archiver « {x} » ?'], { x: p.title }) : t(['حذف «{x}»؟', 'Supprimer « {x} » ?'], { x: p.title })}
        footer={
          <Button
            variant="danger"
            icon={p.shopify_id ? Archive : Trash2}
            loading={busy === 'remove'}
            onClick={() =>
              run('remove', () => (p.shopify_id ? api.post(`/products/${p.id}/archive`, {}, { project: p.project_id }) : api.del(`/products/${p.id}`, { project: p.project_id })), {
                success: p.shopify_id ? t(['أُرشف المنتج', 'Produit archivé']) : t(['حُذف المنتج', 'Produit supprimé']),
              }).then((r) => r && nav('/products'))
            }
          >
            {p.shopify_id ? t(['أرشفة', 'Archiver']) : t(['حذف نهائي', 'Supprimer définitivement'])}
          </Button>
        }
      >
        <p className="text-sm leading-7 text-sub">
          {p.shopify_id
            ? t([
                'المنتج موجود في Shopify، فحذفه من الـ ERP وحده يعيده مع أول مزامنة. الأرشفة تخفيه من المتجر ومن قائمة المنتجات، وتبقي طلبياته وأرقامه. تجده في فلتر «مؤرشف»، وتعيده من تبويب «النشر».',
                'Le produit est sur Shopify : le supprimer de l’ERP seul le ferait revenir à la synchro. L’archiver le retire de la boutique et de la liste, en gardant commandes et chiffres. Filtre « Archivé » ; restauration depuis « Publication ».',
              ])
            : t([
                'المنتج غير منشور في Shopify. الحذف يمحوه من الـ ERP نهائياً، والطلبيات القديمة تبقى باسمه. يُطلب منك كلمة المرور الحساسة.',
                'Produit absent de Shopify. La suppression l’efface de l’ERP ; les anciennes commandes gardent son nom. Mot de passe sensible demandé.',
              ])}
        </p>
      </Modal>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'product', label: t(['المنتج', 'Produit']), icon: Package },
          { value: 'seo', label: 'SEO', icon: Search },
          { value: 'marketing', label: t(['حزمة التسويق', 'Kit marketing']), icon: Sparkles },
          { value: 'publish', label: t(['النشر', 'Publication']), icon: Globe },
          { value: 'ad', label: t(['الإعلان والاختبار', 'Pub & test']), icon: Megaphone },
        ]}
      />
      {tab === 'product' && <ProductTab p={p} f={f} set={set} reload={reload} dirty={dirty} />}
      {tab === 'seo' && <SeoTab p={p} f={f} set={set} onApplied={reload} />}
      {tab === 'marketing' && <MarketingTab p={p} onImagesAdded={reload} />}
      {tab === 'publish' && <PublishTab p={p} dirty={dirty.length} onDone={reload} />}
      {tab === 'ad' && <AdTab p={p} f={f} set={set} onLaunch={() => setLaunch(true)} />}
      {launch && (
        <LaunchCampaign
          productId={p.id}
          projectId={p.project_id}
          open={launch}
          onClose={(created) => {
            setLaunch(false);
            if (created) reload(true);
          }}
        />
      )}
      {dirty.length > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-brand/40 bg-surface/95 px-4 py-2 shadow-pop backdrop-blur">
          <span className="text-sm text-sub">{t(['تعديلات غير محفوظة: {n}', 'Modifications non enregistrées : {n}'], { n: dirty.length })}</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setF(Object.fromEntries(EDIT_KEYS.map((k) => [k, p[k] ?? (LIST_KEYS.includes(k) ? [] : '')])))}>
              {t('c.cancel')}
            </Button>
            <Button size="sm" variant="primary" icon={Save} loading={busy === 'save'} onClick={save}>
              {t('c.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * أسئلة الزبائن عن المنتج (من تحليل صفحته، نفس ما يظهر عند إنشاء صفحة هبوط): الجواب هنا يُحفظ في المواصفات،
 * ويُنشر في صفحة المنتج على Shopify، وتستعمله صفحات الهبوط وSEO. التعديلات غير المحفوظة تُحفظ أولاً حتى لا تضيع.
 */
function CustomerQuestions({ p, dirty, reload }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [insight, setInsight] = useState(undefined);
  const opts = { project: p.project_id };
  useEffect(() => {
    let live = true;
    api.get(`/pages/landing/insight?product_id=${p.id}`, opts).then(
      (r) => live && setInsight(r.insight),
      () => live && setInsight(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, p.project_id]);
  const analyze = () => run('analyze', () => api.post('/pages/landing/analyze', { product_id: p.id, fresh: true }, opts), { success: false }).then((r) => r && setInsight(r));
  if (insight === undefined) return null;
  const open = insight?.missing?.length || 0;
  return (
    <Card
      title={t(['أسئلة الزبائن عن هذا المنتج', 'Questions des clients sur ce produit'])}
      subtitle={t(['من تحليل صفحة المنتج. جوابك يُضاف إلى المواصفات، ثم إلى صفحة المنتج في المتجر، وتستعمله صفحات الهبوط وSEO.', 'D’après l’analyse de la fiche. Votre réponse va dans les caractéristiques, puis sur la fiche en ligne, les landings et le SEO.'])}
      actions={
        <Button size="sm" variant="ghost" icon={Sparkles} loading={busy === 'analyze'} onClick={analyze}>
          {insight ? t(['حلّل من جديد', 'Relancer']) : t(['اكتشف أسئلة الزبائن', 'Trouver les questions'])}
        </Button>
      }
    >
      {!insight ? (
        <p className="text-sm text-sub">{t(['Claude يقرأ صفحة المنتج وصوره، ويستخرج ما يسأل عنه الزبون ولا تجيب عنه الصفحة، مع زوايا بيع خاصة بالمنتج.', 'Claude lit la fiche et les photos, et liste ce que les clients demandent sans réponse sur la page, avec des angles de vente.'])}</p>
      ) : (
        <>
          {insight.stale && <p className="mb-2 text-xs text-muted">{t(['تغيّرت صفحة المنتج منذ التحليل: «حلّل من جديد» يحدّث الأسئلة والزوايا.', 'La fiche a changé depuis l’analyse : « Relancer » met à jour.'])}</p>}
          {!open && !insight.answered?.length && <p className="text-sm text-sub">{t(['لا أسئلة مفتوحة: صفحة المنتج تجيب عمّا يسأل عنه الزبون عادة.', 'Aucune question ouverte.'])}</p>}
          <ProductQuestions
            insight={insight}
            productId={p.id}
            project={p.project_id}
            onInsight={setInsight}
            onProduct={() => reload(true)}
            onReanalyze={analyze}
            blocked={dirty.length ? t(['لديك تعديلات غير محفوظة في البطاقة: احفظها أولاً (زر «حفظ» في الأعلى) حتى لا تضيع.', 'Modifications non enregistrées : enregistrez d’abord.']) : null}
          />
        </>
      )}
    </Card>
  );
}

function ProductTab({ p, f, set, reload, dirty = [] }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const fileRef = useRef(null);
  const [stockDelta, setStockDelta] = useState('');
  const [stockReason, setStockReason] = useState('');
  const multi = (p.variants || []).length > 1;
  const [stockVariant, setStockVariant] = useState('');
  const collections = useApi('/products/collections', { deps: [p.project_id] });
  const suppliers = useApi(`/contacts${qs({ kind: 'supplier' })}`);
  const [catQ, setCatQ] = useState('');
  const dCat = useDebounced(catQ, 350);
  const cats = useApi(dCat.length >= 2 ? `/products/categories${qs({ q: dCat })}` : null, { skip: dCat.length < 2 });
  const upload = async (files) => {
    const fd = new FormData();
    for (const file of files) fd.append('images', file);
    const r = await run('upload', () => api.post(`/products/${p.id}/images`, fd, { project: p.project_id }), { success: t(['رُفعت الصور', 'Images ajoutées']) });
    if (r) reload(true);
  };
  const margin = f.price ? Number(f.price) - Number(f.cost_price || 0) - Number(f.packaging_cost || 0) : null;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <Card title={t(['المعلومات الأساسية', 'Informations'])}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t(['اسم المنتج', 'Nom du produit'])} className="sm:col-span-2">
              <Input value={f.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label={t(['الرابط (handle)', 'Handle (URL)'])}>
              <Input className="ltr" value={f.handle} onChange={(e) => set({ handle: e.target.value })} />
            </Field>
            <Field label={t(['المرحلة', 'Étape'])}>
              <Select value={f.stage} onChange={(e) => set({ stage: e.target.value })} options={Object.entries(STAGES).map(([k, v]) => ({ value: k, label: t(v) }))} />
            </Field>
            <Field label={t(['نوع المنتج', 'Type de produit'])}>
              <Input value={f.product_type} onChange={(e) => set({ product_type: e.target.value })} />
            </Field>
            <Field label="SKU">
              <Input className="ltr" value={f.sku} onChange={(e) => set({ sku: e.target.value })} />
            </Field>
            <Field label={t(['التصنيف في Shopify (Google)', 'Catégorie Shopify (Google)'])} className="sm:col-span-2" hint={f.category_name || null}>
              <div className="relative">
                <Input value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder={f.category_name || t(['ابحث: Thermos, Toys…', 'Rechercher : Thermos, Toys…'])} />
                {cats.data?.length > 0 && catQ && (
                  <div className="card absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto p-1 shadow-pop">
                    {cats.data.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full rounded px-2 py-1.5 text-start text-xs hover:bg-raised"
                        onClick={() => {
                          set({ category_id: c.id, category_name: c.fullName });
                          setCatQ('');
                        }}
                      >
                        {c.fullName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </div>
        </Card>

        <Card
          title={t(['الصور', 'Images'])}
          actions={
            <>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
              <Button size="sm" icon={Upload} loading={busy === 'upload'} onClick={() => fileRef.current?.click()}>
                {t(['رفع صور', 'Ajouter'])}
              </Button>
            </>
          }
        >
          {f.images.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {f.images.map((img, k) => (
                <div key={img.url + k} className="space-y-1.5">
                  <div className="relative overflow-hidden rounded-lg border border-line">
                    <img src={img.url} alt={img.alt} className="aspect-square w-full object-cover" loading="lazy" />
                    {k === 0 && <Badge tone="brand" className="absolute start-1 top-1">{t(['الرئيسية', 'Principale'])}</Badge>}
                    <div className="absolute end-1 top-1 flex gap-1">
                      {k > 0 && (
                        <button type="button" className="rounded bg-black/60 p-1 text-white" title={t(['اجعلها الرئيسية', 'Définir principale'])} onClick={() => set({ images: [img, ...f.images.filter((_, j) => j !== k)] })}>
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button type="button" className="rounded bg-black/60 p-1 text-white" title={t('c.delete')} onClick={() => set({ images: f.images.filter((_, j) => j !== k) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <Input className="px-2 py-1 text-xs" value={img.alt || ''} placeholder={t(['نص بديل (SEO)', 'Texte alt (SEO)'])} onChange={(e) => set({ images: f.images.map((x, j) => (j === k ? { ...x, alt: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={ImagePlus} title={t(['لا صور بعد', 'Aucune image'])}>
              {t(['ارفع صور المنتج أو ولّدها من «حزمة التسويق».', 'Ajoutez des photos ou générez-les dans « Kit marketing ».'])}
            </Empty>
          )}
        </Card>

        <Card title={t(['الوصف (HTML)', 'Description (HTML)'])} subtitle={t(['يُفضّل توليده من تبويب SEO', 'Idéalement généré depuis l’onglet SEO'])}>
          <Textarea aria-label={t(['الوصف (HTML)', 'Description (HTML)'])} className="min-h-[220px] font-mono text-xs" dir="auto" value={f.description_html || ''} onChange={(e) => set({ description_html: e.target.value })} />
        </Card>

        <Card title={t(['المعلومات التقنية والمواصفات', 'Infos techniques & caractéristiques'])}>
          <div className="space-y-3">
            <Field label={t(['ملاحظات تقنية (المادة، السعة، المقاسات، الاستعمال…)', 'Notes techniques (matière, capacité, dimensions, usage…)'])}>
              <Textarea value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
            <div>
              <div className="label">{t(['جدول المواصفات', 'Tableau des caractéristiques'])}</div>
              <div className="space-y-2">
                {f.specs.map((s, k) => (
                  <div key={k} className="flex gap-2">
                    <Input className="w-40" value={s.label} onChange={(e) => set({ specs: f.specs.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} placeholder={t(['الخاصية', 'Propriété'])} />
                    <Input value={s.value} onChange={(e) => set({ specs: f.specs.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} placeholder={t(['القيمة', 'Valeur'])} />
                    <Button aria-label={t(['إزالة السطر', 'Retirer la ligne'])} size="sm" variant="ghost" icon={XCircle} onClick={() => set({ specs: f.specs.filter((_, j) => j !== k) })} />
                  </div>
                ))}
                <Button size="sm" icon={Plus} onClick={() => set({ specs: [...f.specs, { label: '', value: '' }] })}>
                  {t('c.add')}
                </Button>
              </div>
            </div>
            <Field label={t(['الجمهور المستهدف', 'Audience cible'])}>
              <Input value={f.audience || ''} onChange={(e) => set({ audience: e.target.value })} />
            </Field>
          </div>
        </Card>

        <CustomerQuestions p={p} dirty={dirty} reload={reload} />
      </div>

      <div className="min-w-0 space-y-4">
        <Card title={t(['السعر والهامش', 'Prix & marge'])} subtitle={p.shopify_id ? t(['تغيير سعر منتج منشور يتطلب كلمة المرور الحساسة', 'Modifier le prix d’un produit publié demande le mot de passe sensible']) : null}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t(['سعر البيع', 'Prix'])}>
              <Input type="number" value={f.price ?? ''} onChange={(e) => set({ price: e.target.value })} />
            </Field>
            <Field label={t(['قبل التخفيض', 'Prix barré'])}>
              <Input type="number" value={f.compare_at_price ?? ''} onChange={(e) => set({ compare_at_price: e.target.value })} />
            </Field>
            <Field label={t(['سعر الشراء', "Prix d'achat"])}>
              <Input type="number" value={f.cost_price ?? ''} onChange={(e) => set({ cost_price: e.target.value })} />
            </Field>
            <Field label={t(['التغليف', 'Emballage'])}>
              <Input type="number" value={f.packaging_cost ?? ''} onChange={(e) => set({ packaging_cost: e.target.value })} />
            </Field>
          </div>
          {margin !== null && (
            <div className="mt-3 rounded-lg bg-raised p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-sub">{t(['الهامش لكل قطعة', 'Marge unitaire'])}</span>
                <b className={margin < 0 ? 'text-bad' : ''}>{da(margin)}</b>
              </div>
              {p.break_even && (
                <div className="mt-1 flex justify-between text-xs">
                  <span className="text-sub">{t(['أقصى تكلفة إعلان لكل مسلّمة', 'Coût pub max / livrée'])}</span>
                  <b>{da(p.break_even.da)}</b>
                </div>
              )}
              {p.break_even && <p className="mt-1 text-[11px] text-muted">{t(['محسوب بنسبة تسليم {d}% وتكلفة المرتجع', 'Calculé avec {d} % de livraison et le coût de retour'], { d: p.break_even.delivery_rate })}</p>}
            </div>
          )}
        </Card>

        <Card title={t(['الخيارات والمتغيرات', 'Options et variantes'])} subtitle={t(['اللون، المقاس، الموديل… لكل تركيبة سعرها ومخزونها', 'Couleur, taille, modèle… prix et stock par combinaison'])}>
          <VariantsEditor
            key={p.id}
            options={f.options}
            variants={f.variants}
            price={f.price}
            compare={f.compare_at_price}
            onShopify={Boolean(p.shopify_id)}
            onChange={({ options, variants }) => set({ options, variants })}
          />
        </Card>

        <Card title={t('c.stock')}>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-semibold num">{p.stock === null ? '∞' : n0(p.stock)}</span>
            <Field label={t(['حد التنبيه', 'Seuil d’alerte'])}>
              <Input type="number" className="w-24" value={f.low_stock ?? ''} onChange={(e) => set({ low_stock: e.target.value })} />
            </Field>
          </div>
          {multi && (
            <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {p.variants.map((v) => (
                <li key={v.id || v.title} className="flex justify-between gap-2 rounded bg-raised px-2 py-1">
                  <span className="truncate" dir="auto">
                    {v.title}
                  </span>
                  <span className="num font-semibold">{v.stock === null || v.stock === undefined ? '∞' : n0(v.stock)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {multi && (
              <Select
                className="w-auto"
                aria-label={t(['المتغير', 'Variante'])}
                value={stockVariant}
                onChange={(e) => setStockVariant(e.target.value)}
                placeholder={t(['اختر المتغير', 'Choisir la variante'])}
                options={p.variants.filter((v) => v.id).map((v) => ({ value: v.id, label: v.title }))}
              />
            )}
            <Input type="number" className="w-24" aria-label={t(['الفرق (+/-)', 'Écart (+/-)'])} value={stockDelta} onChange={(e) => setStockDelta(e.target.value)} placeholder="+/-" />
            <Input className="min-w-0 flex-1" aria-label={t(['السبب', 'Motif'])} value={stockReason} onChange={(e) => setStockReason(e.target.value)} placeholder={t(['السبب (وصول سلعة، جرد…)', 'Motif (réception, inventaire…)'])} />
            <Button
              disabled={!Number(stockDelta) || (multi && p.shopify_id && !stockVariant)}
              loading={busy === 'stock'}
              onClick={async () => {
                const r = await run('stock', () => api.post(`/products/${p.id}/stock`, { delta: Number(stockDelta), reason: stockReason, variant_id: stockVariant || null }, { project: p.project_id }), {
                  success: p.shopify_id ? t(['عُدّل المخزون في الـ ERP وفي المتجر', 'Stock ajusté dans l’ERP et la boutique']) : undefined,
                });
                if (r) {
                  setStockDelta('');
                  setStockReason('');
                  reload(true);
                }
              }}
            >
              {t(['تعديل', 'Ajuster'])}
            </Button>
          </div>
          {p.shopify_id && <p className="mt-2 text-[11px] text-muted">{t(['التعديل يصل إلى المتجر فوراً (ملصق «متوفر / باقي N» في صفحة المنتج)، ويُفعَّل تتبّع المخزون.', 'L’ajustement part tout de suite vers la boutique (étiquette « en stock / il en reste N ») et le suivi du stock est activé.'])}</p>}
        </Card>

        <Card title={t(['المجموعات والوسوم', 'Collections & tags'])}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {f.collections.map((c) => (
                <Badge key={c.id || c.title} tone="brand">
                  {c.title}
                  <button type="button" aria-label={t(['إزالة من المجموعة', 'Retirer de la collection'])} onClick={() => set({ collections: f.collections.filter((x) => x !== c) })}>
                    ✕
                  </button>
                </Badge>
              ))}
            </div>
            {f.collections
              .map((c) => collections.data?.find((x) => x.id === c.id))
              .filter((c) => c && c.in_menu === false)
              .map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs leading-6 text-sub">
                  <span className="min-w-0 flex-1">
                    {t(['مجموعة «{x}» ليست في القائمة الرئيسية للمتجر، فلا يجدها الزبون في الشريط العلوي.', 'La collection « {x} » n’est pas dans le menu principal : invisible dans la barre du site.'], { x: c.title })}
                  </span>
                  <Button
                    size="sm"
                    loading={busy === `menu:${c.id}`}
                    onClick={() =>
                      run(`menu:${c.id}`, () => api.post('/products/collections/menu', { id: c.id }, { project: p.project_id }), { success: t(['أُضيفت إلى قائمة المتجر', 'Ajoutée au menu de la boutique']) }).then((r) => r && collections.reload(true))
                    }
                  >
                    {t(['أظهرها في القائمة', 'L’afficher dans le menu'])}
                  </Button>
                </div>
              ))}
            <Select
              value=""
              onChange={(e) => {
                const c = collections.data?.find((x) => x.id === e.target.value);
                if (c && !f.collections.some((x) => x.id === c.id)) set({ collections: [...f.collections, { id: c.id, title: c.title, handle: c.handle }] });
              }}
              placeholder={t(['أضف إلى مجموعة…', 'Ajouter à une collection…'])}
              options={(collections.data || []).map((c) => ({ value: c.id, label: `${c.title} (${c.count})${c.in_menu === false ? ` · ${t(['ليست في القائمة', 'hors menu'])}` : ''}` }))}
            />
            <Field label={t(['الوسوم (افصل بفاصلة)', 'Tags (séparés par virgule)'])}>
              <Input value={f.tags.join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </Field>
          </div>
        </Card>

        <Card title={t(['المورد', 'Fournisseur'])}>
          <div className="space-y-3">
            <Select
              value={f.supplier_id || ''}
              onChange={(e) => set({ supplier_id: e.target.value ? Number(e.target.value) : null })}
              placeholder={f.supplier && !f.supplier_id ? f.supplier : t(['اختر المورد', 'Choisir le fournisseur'])}
              options={(suppliers.data?.rows || []).map((c) => ({ value: c.id, label: c.company ? `${c.name} · ${c.company}` : c.name }))}
            />
            <p className="text-xs text-muted">
              {t(['المورد المربوط يُستعمل لتنبيهات إعادة الطلب والكمية المقترحة.', 'Le fournisseur lié sert aux alertes de réassort et à la quantité suggérée.'])}{' '}
              <Link className="link" to="/contacts?kind=supplier">
                {t(['إدارة الموردين', 'Gérer les fournisseurs'])}
              </Link>
            </p>
            <Input className="ltr" value={f.supplier_url || ''} onChange={(e) => set({ supplier_url: e.target.value })} placeholder={t(['رابط المنتج عند المورد (اختياري)', 'Lien produit chez le fournisseur (facultatif)'])} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function SeoTab({ p, f, set, onApplied }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [report, setReport] = useState(null);
  const [gen, setGen] = useState(null);
  const [instructions, setInstructions] = useState('');
  const draft = useDebounced(JSON.stringify({ title: f.title, handle: f.handle, seo_title: f.seo_title, seo_description: f.seo_description, focus_keyword: f.focus_keyword, description_html: f.description_html, tags: f.tags, images: f.images, collections: f.collections, product_type: f.product_type, specs: f.specs, price: f.price, compare_at_price: f.compare_at_price }), 500);
  useEffect(() => {
    api.post(`/products/${p.id}/seo/check`, JSON.parse(draft), { project: p.project_id }).then(setReport, () => {});
  }, [draft, p.id, p.project_id]);
  const generate = async () => {
    const r = await run('gen', () => api.post(`/products/${p.id}/seo/generate`, { instructions }, { project: p.project_id }), { success: false });
    if (r) setGen(r);
  };
  const apply = async () => {
    const r = await run('apply', () => api.post(`/products/${p.id}/seo/apply`, gen, { project: p.project_id }), { success: t(['طُبّق SEO على المنتج — انشره ليظهر في المتجر', 'SEO appliqué — publiez pour mettre à jour la boutique']) });
    if (r) {
      setGen(null);
      onApplied(true);
    }
  };
  const domain = (() => {
    try {
      return new URL(p.online_url).host;
    } catch {
      return 'souqnna.com';
    }
  })();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <Card title={t(['توليد صفحة SEO احترافية بالذكاء الاصطناعي', 'Générer une fiche SEO professionnelle (IA)'])} icon={Wand2}>
          <p className="mb-3 text-xs leading-5 text-sub">
            {t(
              ['يكتب العنوان، الكلمة المفتاحية، وصف Google، الرابط، الوصف الكامل بعناوين ومواصفات وأسئلة شائعة، الوسوم ونصوص الصور — بالعربية لجمهور جزائري، دون تكرار ودون وعود كاذبة. لا شيء يُطبّق قبل موافقتك.', 'Rédige titre, mot-clé, méta, URL, description complète (titres, caractéristiques, FAQ), tags et textes alt — pour le public algérien, sans promesses trompeuses. Rien n’est appliqué sans votre accord.'],
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t(['تعليمات إضافية (اختياري): مثال «ركّز على الهدية للأم»', 'Instructions (facultatif) : ex. « angle cadeau pour maman »'])} />
            <Button variant="primary" icon={Sparkles} loading={busy === 'gen'} onClick={generate}>
              {t('c.generate')}
            </Button>
          </div>
          {busy === 'gen' && <p className="mt-2 text-xs text-muted">{t(['يقرأ الذكاء الاصطناعي الصور والمعلومات… (قرابة دقيقة)', "L'IA lit les images et les infos… (≈ 1 min)"])}</p>}
          {gen && (
            <div className="mt-4 space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-sm">{t(['المقترح', 'Proposition'])}</b>
                <Badge tone={seoTone(gen.preview_score)}>
                  SEO {report?.score ?? '—'} → {gen.preview_score}
                </Badge>
              </div>
              <Preview label={t(['العنوان', 'Titre'])} value={gen.title} />
              <Preview label={t(['الكلمة المفتاحية', 'Mot-clé'])} value={gen.focus_keyword} />
              <Preview label={t(['عنوان SEO', 'Titre SEO'])} value={`${gen.seo_title} (${gen.seo_title.length})`} />
              <Preview label={t(['وصف SEO', 'Méta-description'])} value={`${gen.seo_description} (${gen.seo_description.length})`} />
              <Preview label="Handle" value={gen.handle} ltr />
              <Preview label={t(['الوسوم', 'Tags'])} value={gen.tags.join('، ')} />
              {gen.collections?.length > 0 && <Preview label={t(['المجموعات', 'Collections'])} value={gen.collections.map((c) => c.title).join('، ')} />}
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-sub">{t(['الوصف الكامل', 'Description complète'])}</summary>
                <div className="prose-sm mt-2 max-h-80 overflow-y-auto rounded bg-surface p-3 text-sm leading-7 [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:ms-5 [&_li]:list-disc [&_table]:my-2 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2" dangerouslySetInnerHTML={{ __html: sanitize(gen.description_html) }} />
              </details>
              {gen.notes && <p className="text-xs text-sub">💡 {gen.notes}</p>}
              <div className="flex gap-2">
                <Button variant="primary" icon={CheckCircle2} loading={busy === 'apply'} onClick={apply}>
                  {t(['تطبيق على المنتج', 'Appliquer au produit'])}
                </Button>
                <Button onClick={() => setGen(null)}>{t(['تجاهل', 'Ignorer'])}</Button>
              </div>
            </div>
          )}
        </Card>
        <Card title={t(['حقول SEO', 'Champs SEO'])}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t(['الكلمة المفتاحية الرئيسية', 'Mot-clé principal'])}>
              <Input value={f.focus_keyword || ''} onChange={(e) => set({ focus_keyword: e.target.value })} />
            </Field>
            <Field label="Handle">
              <Input className="ltr" value={f.handle || ''} onChange={(e) => set({ handle: e.target.value })} />
            </Field>
            <Field label={t(['عنوان SEO', 'Titre SEO'])} hint={`${(f.seo_title || '').length}/65`} className="sm:col-span-2">
              <Input value={f.seo_title || ''} onChange={(e) => set({ seo_title: e.target.value })} />
            </Field>
            <Field label={t(['وصف SEO', 'Méta-description'])} hint={`${(f.seo_description || '').length}/165`} className="sm:col-span-2">
              <Textarea value={f.seo_description || ''} onChange={(e) => set({ seo_description: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 rounded-lg border border-line bg-white p-3 text-start dark:bg-raised" dir="auto">
            <div className="text-xs text-[#1a0dab]/70 dark:text-sub">
              {domain} › products › {f.handle}
            </div>
            <div className="truncate text-base text-[#1a0dab] dark:text-info">{f.seo_title || f.title}</div>
            <div className="line-clamp-2 text-xs text-[#4d5156] dark:text-sub">{f.seo_description || '—'}</div>
          </div>
        </Card>
      </div>
      <Card title={t(['تقييم SEO مباشر', 'Score SEO en direct'])}>
        {!report ? (
          <Loading />
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className={cx('text-4xl font-semibold', report.score >= 80 ? 'text-good' : report.score >= 60 ? 'text-warn' : 'text-bad')}>{report.score}</span>
              <span className="text-sm text-muted">/100 · {report.words} {t(['كلمة', 'mots'])}</span>
            </div>
            <Bar value={report.score} tone={report.score >= 80 ? 'good' : report.score >= 60 ? 'warn' : 'bad'} />
            <ul className="space-y-1.5 text-xs">
              {report.checks
                .slice()
                .sort((a, b) => Number(a.ok) - Number(b.ok) || b.weight - a.weight)
                .map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" /> : c.partial ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />}
                    <span className={cx('flex-1', c.ok ? 'text-sub' : 'text-ink')}>{t(SEO_LABELS[c.key] || [c.key, c.key])}</span>
                    {c.value !== null && c.value !== undefined && c.value !== '' && typeof c.value !== 'object' && <span className="num text-muted">{String(c.value).slice(0, 24)}</span>}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

/** تنقية HTML المولّد قبل المعاينة (إزالة السكربتات والأحداث والروابط التنفيذية، حتى المموّهة مثل «java&#9;script:») */
function sanitize(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script,style,iframe,frame,object,embed,link,meta,base,form').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      // eslint-disable-next-line no-control-regex
      const value = a.value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
      if (/^on/i.test(a.name) || /^(srcdoc|formaction)$/i.test(a.name) || /(javascript|vbscript):/.test(value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

function Preview({ label, value, ltr }) {
  return (
    <div className="text-sm">
      <span className="text-xs text-muted">{label}: </span>
      <span className={ltr ? 'ltr' : ''}>{value}</span>
    </div>
  );
}

function MarketingTab({ p, onImagesAdded }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const creatives = useApi(`/products/${p.id}/creatives`);
  const [instructions, setInstructions] = useState('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(2);
  const copies = (creatives.data || []).filter((c) => c.kind === 'copy');
  const images = (creatives.data || []).filter((c) => c.kind === 'image' && c.url);
  const latest = copies[0]?.content;
  const genCopy = async () => {
    const r = await run('copy', () => api.post(`/products/${p.id}/ad-copy`, { instructions }, { project: p.project_id }), { success: t(['جاهزة', 'Prêt']) });
    if (r) creatives.reload(true);
  };
  const genImages = async () => {
    const r = await run('img', () => api.post(`/products/${p.id}/images/generate`, { prompt, count }, { project: p.project_id }), { success: t(['وُلّدت الصور', 'Images générées']) });
    if (r) creatives.reload(true);
  };
  const addToProduct = async (url) => {
    const r = await run('add', () => api.patch(`/products/${p.id}`, { images: [...(p.images || []), { url, alt: '' }] }, { project: p.project_id }), { success: t(['أُضيفت إلى صور المنتج', 'Ajoutée aux images du produit']) });
    if (r) onImagesAdded(true);
  };
  return (
    <div className="space-y-4">
      <Card title={t(['نصوص إعلانية بزوايا مختلفة (دارجة، عربية، فرنسية)', 'Textes pub multi-angles (darija, arabe, français)'])} icon={Sparkles}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t(['تعليمات (اختياري): عرض 2 بسعر خاص، هدية…', 'Instructions : offre 2 pour…, cadeau…'])} />
          <Button variant="primary" icon={Wand2} loading={busy === 'copy'} onClick={genCopy}>
            {t('c.generate')}
          </Button>
        </div>
        {latest ? (
          <div className="mt-4 space-y-3">
            {latest.audience && (
              <p className="text-xs text-sub">
                <b className="text-ink">{t(['الجمهور:', 'Audience :'])}</b> {latest.audience}
              </p>
            )}
            {latest.angles?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {latest.angles.map((a) => (
                  <Badge key={a} tone="brand">
                    {a}
                  </Badge>
                ))}
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              {latest.variants.map((v, k) => (
                <div key={k} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex gap-1.5">
                      <Badge>{v.language}</Badge>
                      <Badge tone="info">{v.angle}</Badge>
                    </div>
                    <CopyButton text={`${v.primary_text}\n\n${v.headline}\n${v.description}`} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6" dir="auto">
                    {v.primary_text}
                  </p>
                  <p className="mt-2 text-sm font-semibold" dir="auto">
                    {v.headline}
                  </p>
                  <p className="text-xs text-sub" dir="auto">
                    {v.description}
                  </p>
                </div>
              ))}
            </div>
            {latest.image_prompts?.length > 0 && (
              <div>
                <div className="label">{t(['أفكار صور (اضغط لاستعمالها)', 'Idées d’images (cliquez pour utiliser)'])}</div>
                <div className="flex flex-wrap gap-1.5">
                  {latest.image_prompts.map((ip) => (
                    <button key={ip} type="button" className="chip ltr max-w-full truncate bg-raised text-start text-sub hover:text-ink" onClick={() => setPrompt(ip)}>
                      {ip}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">{t(['لم تُولَّد نصوص بعد.', 'Aucun texte généré.'])}</p>
        )}
      </Card>
      <Card title={t(['توليد صور إعلانية من صور المنتج', 'Générer des visuels pub à partir des photos'])} icon={ImagePlus}>
        <div className="space-y-2">
          <Textarea className="ltr min-h-[70px]" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Square ad photo of the product on a kitchen counter, warm morning light, no text…" />
          <div className="flex items-center gap-2">
            <Select className="w-24" value={count} onChange={(e) => setCount(Number(e.target.value))} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `× ${n}` }))} />
            <Button variant="primary" icon={Wand2} loading={busy === 'img'} disabled={!prompt.trim()} onClick={genImages}>
              {t('c.generate')}
            </Button>
            <span className="text-xs text-muted">{t(['المزوّد يُحدد في الإعدادات (n8n / OpenAI / Gemini)', 'Fournisseur défini dans les paramètres (n8n / OpenAI / Gemini)'])}</span>
          </div>
        </div>
        {images.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((img) => (
              <div key={img.id} className="space-y-1.5">
                <img src={img.url} alt="" className="aspect-square w-full rounded-lg border border-line object-cover" loading="lazy" />
                <Button size="sm" className="w-full" icon={Plus} disabled={(p.images || []).some((x) => x.url === img.url)} onClick={() => addToProduct(img.url)}>
                  {t(['إلى صور المنتج', 'Aux images'])}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const PUBLISH_WARNINGS = {
  online_store_scope_missing: [
    'نُشر المنتج لكنه غير ظاهر في الموقع: ينقص تطبيق Shopify الإذن write_publications. أضفه في Dev Dashboard ← التطبيق ← Versions ← Release، ثم وافق عليه في المتجر (افتح التطبيق من «Applications»)، ثم اضغط «تحديث على المتجر» مرة أخرى.',
    'Produit publié mais invisible sur le site : l’app Shopify n’a pas l’autorisation write_publications. Ajoutez-la (Dev Dashboard → app → Versions → Release), approuvez-la dans la boutique, puis « Mettre à jour » à nouveau.',
  ],
  online_store_not_found: ['لم يُعثر على قناة «المتجر الإلكتروني» في المتجر.', 'Canal « Boutique en ligne » introuvable.'],
};

function PublishTab({ p, dirty, onDone }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [warnings, setWarnings] = useState([]);
  const [msg, setMsg] = useState('');
  const [platforms, setPlatforms] = useState(['facebook']);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Shopify" icon={Globe}>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {p.shopify_id ? <Badge tone="good">{t(['مرتبط بـ Shopify', 'Lié à Shopify'])}</Badge> : <Badge tone="warn">{t(['غير منشور بعد', 'Pas encore publié'])}</Badge>}
            {p.shopify_status && <Badge>{p.shopify_status}</Badge>}
            <Badge tone={seoTone(p.seo_score)}>SEO {p.seo_score ?? '—'}</Badge>
          </div>
          {dirty > 0 && <p className="text-xs text-warn">{t(['احفظ التعديلات أولاً.', 'Enregistrez d’abord vos modifications.'])}</p>}
          {(p.seo_score ?? 0) < 70 && <p className="text-xs text-sub">{t(['نصيحة: ارفع تقييم SEO إلى 80+ قبل النشر (تبويب SEO).', 'Conseil : visez un SEO ≥ 80 avant de publier.'])}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={Send}
              disabled={dirty > 0}
              loading={busy === 'pub'}
              onClick={() =>
                run('pub', () => api.post(`/products/${p.id}/publish`, { status: 'ACTIVE' }, { project: p.project_id }), { success: t(['نُشر على المتجر', 'Publié sur la boutique']) }).then((r) => {
                  if (!r) return;
                  setWarnings(r.warnings || []);
                  onDone(true);
                })
              }
            >
              {p.shopify_id ? t(['تحديث على المتجر (نشط)', 'Mettre à jour (actif)']) : t(['نشر على المتجر', 'Publier sur la boutique'])}
            </Button>
            <Button disabled={dirty > 0} loading={busy === 'draft'} onClick={() => run('draft', () => api.post(`/products/${p.id}/publish`, { status: 'DRAFT' }, { project: p.project_id }), { success: t(['أُرسل كمسودة', 'Envoyé en brouillon']) }).then((r) => r && onDone(true))}>
              {t(['إرسال كمسودة', 'Envoyer en brouillon'])}
            </Button>
          </div>
          {warnings.map((w) => (
            <p key={w} className="rounded-lg bg-warn/10 p-3 text-xs leading-6 text-sub">
              {PUBLISH_WARNINGS[w.split(':')[0]] ? t(PUBLISH_WARNINGS[w.split(':')[0]]) : w}
            </p>
          ))}
          <p className="text-[11px] leading-5 text-muted">
            {t([
              'النشر يطابق المتجر مع الـ ERP: الصور المحذوفة تُزال من المنتج، الصورة الأولى هي الرئيسية، الخيارات والمتغيرات كما هنا، والمنتج النشط يظهر في «المتجر الإلكتروني».',
              'La publication aligne la boutique sur l’ERP : images supprimées retirées, la première est la principale, options et variantes identiques, et le produit actif apparaît dans la « Boutique en ligne ».',
            ])}
          </p>
          {p.online_url && (
            <a className="link inline-flex items-center gap-1 text-xs" href={p.online_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              {p.online_url}
            </a>
          )}
        </div>
      </Card>
      <Card title={t(['النشر على الصفحة وإنستغرام', 'Publier sur la page et Instagram'])} icon={Megaphone}>
        <div className="space-y-3">
          <Textarea className="min-h-[120px]" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t(['نص المنشور (يمكن نسخه من حزمة التسويق)', 'Texte de la publication'])} />
          <div className="flex gap-4">
            <Toggle checked={platforms.includes('facebook')} onChange={(v) => setPlatforms(v ? [...new Set([...platforms, 'facebook'])] : platforms.filter((x) => x !== 'facebook'))} label="Facebook" />
            <Toggle checked={platforms.includes('instagram')} onChange={(v) => setPlatforms(v ? [...new Set([...platforms, 'instagram'])] : platforms.filter((x) => x !== 'instagram'))} label="Instagram" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Send} disabled={!msg.trim() || !platforms.length} loading={busy === 'social'} onClick={() => run('social', () => api.post(`/products/${p.id}/social`, { message: msg, platforms }, { project: p.project_id }), { success: t(['نُشر', 'Publié']) })}>
              {t(['نشر الآن', 'Publier'])}
            </Button>
            <Button icon={Send} loading={busy === 'tg'} onClick={() => run('tg', () => api.post(`/products/${p.id}/telegram`, { post: msg }, { project: p.project_id }), { success: t(['أُرسل إلى تيليغرام عبر n8n', 'Envoyé sur Telegram via n8n']) })}>
              {t(['إرسال إلى تيليغرام (n8n)', 'Telegram (n8n)'])}
            </Button>
          </div>
          <p className="text-[11px] text-muted">{t(['يتطلب صورة عامة (https) للمنتج ورمز الصفحة في الإعدادات.', 'Nécessite une image publique (https) et le jeton de page.'])}</p>
        </div>
      </Card>
    </div>
  );
}

const VERDICT = {
  winning: ['رابح', 'Gagnant', 'good'],
  thin: ['هامش ضيق', 'Marge faible', 'warn'],
  losing: ['خاسر', 'Perdant', 'bad'],
  pending: ['بانتظار التسليم', 'En attente des livraisons', 'info'],
  insufficient: ['بيانات غير كافية', 'Données insuffisantes', 'neutral'],
  no_ads: ['بلا إعلانات', 'Sans pub', 'neutral'],
};
export { VERDICT };

function AdTab({ p, f, set, onLaunch }) {
  const { t } = useI18n();
  const [days, setDays] = useState(7);
  const { data: tst, loading, error, reload } = useApi(`/products/${p.id}/test${qs({ days })}`);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t(['مرحلة الاختبار', 'Étape du test'])}>
          <div className="space-y-3">
            <Select value={f.test_stage} onChange={(e) => set({ test_stage: e.target.value })} options={Object.entries(TEST_STAGES).map(([k, v]) => ({ value: k, label: t(v) }))} />
            <Field label={t(['ميزانية الاختبار الكلية (دج)', 'Budget total du test (DA)'])}>
              <Input type="number" value={f.test_budget_da ?? ''} onChange={(e) => set({ test_budget_da: e.target.value })} />
            </Field>
            <Field label={t(['ملاحظة القرار', 'Note de décision'])}>
              <Textarea value={f.decision_note || ''} onChange={(e) => set({ decision_note: e.target.value })} />
            </Field>
            <Button className="w-full" variant="primary" icon={Rocket} onClick={onLaunch}>
              {t(['إطلاق حملة لهذا المنتج', 'Lancer une campagne pour ce produit'])}
            </Button>
          </div>
        </Card>
        <Card
          title={t(['نتيجة الاختبار — بالطلبيات الحقيقية', 'Résultat du test — commandes réelles'])}
          className="lg:col-span-2"
          actions={<Select className="w-auto py-1" value={days} onChange={(e) => setDays(Number(e.target.value))} options={[3, 7, 14, 30].map((d) => ({ value: d, label: `${d} ${t('c.days')}` }))} />}
        >
          {loading && !tst ? (
            <Loading />
          ) : error ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={VERDICT[tst.verdict]?.[2]} className="px-3 py-1 text-sm">
                  {t(VERDICT[tst.verdict] || [tst.verdict, tst.verdict])}
                </Badge>
                {tst.break_even && (
                  <span className="text-xs text-sub">
                    {t(['حد التعادل لكل مسلّمة:', 'Seuil par livrée :'])} <b className="text-ink">{da(tst.break_even.da)}</b>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t(['الإنفاق', 'Dépense'])} value={da(tst.spend_da)} hint={tst.spend ? money(tst.spend, tst.spend_currency) : null} />
                <Stat label={t('c.orders')} value={n0(tst.orders)} hint={`${t(['مؤكدة', 'conf.'])} ${n0(tst.confirmed)}`} />
                <Stat label={t(['مسلّمة', 'Livrées'])} value={n0(tst.delivered)} hint={`${t(['متوقعة', 'attendues'])} ${tst.expected_delivered}`} />
                <Stat label={t(['تكلفة المسلّمة', 'Coût / livrée'])} value={da(tst.cost_per_delivered_da)} tone={tst.break_even && tst.cost_per_delivered_da > tst.break_even.da ? 'bad' : 'good'} />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-sub">
                <span>
                  {t(['الربح التقديري:', 'Profit estimé :'])} <b className={tst.profit_da < 0 ? 'text-bad' : 'text-good'}>{da(tst.profit_da)}</b>
                </span>
                <span>
                  {t(['مشتريات البيكسل (للعلم فقط):', 'Achats pixel (info) :'])} {n0(tst.pixel_purchases)}
                </span>
                <span>
                  {t(['مرتجعة:', 'Retours :'])} {n0(tst.returned)} · {t(['في الطريق:', 'En cours :'])} {n0(tst.in_flight)}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>
      <Card title={t(['حملات هذا المنتج', 'Campagnes de ce produit'])} pad={false}>
        {tst?.campaigns?.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <tbody>
                {tst.campaigns.map((c) => (
                  <tr key={c.campaign_id}>
                    <td className="font-medium">
                      <Link className="link" to={`/ads?campaign=${c.campaign_id}&account=${c.account_id}`}>
                        {c.name}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={c.effective_status === 'ACTIVE' ? 'good' : c.issues?.length ? 'bad' : 'neutral'}>{c.effective_status}</Badge>
                    </td>
                    <td className="num text-end">{c.daily_budget ? money(c.daily_budget, c.currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Megaphone} title={t(['لا حملات مرتبطة', 'Aucune campagne liée'])}>
            {t(['أطلق حملة من هنا، أو اربط حملة موجودة من صفحة الإعلانات.', 'Lancez-en une ou liez une campagne existante depuis Pubs.'])}
          </Empty>
        )}
      </Card>
    </div>
  );
}
