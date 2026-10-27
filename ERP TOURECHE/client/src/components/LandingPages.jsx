import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, ExternalLink, Eye, Rocket, Sparkles, Split, Trash2, Wand2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useApp } from './ProjectContext.jsx';
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, Textarea, cx, useAction } from './ui.jsx';

const STATUS = { draft: ['مسودة', 'Brouillon', 'neutral'], published: ['منشورة', 'Publiée', 'good'], unpublished: ['مسحوبة', 'Retirée', 'warn'] };
const latin = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
const hostOf = (base) => String(base || '').replace(/^https?:\/\//, '');

/** معاينة النص كما سيظهر في الصفحة (الترتيب نفسه): العنوان ← الفقرات ← الفوائد ← الخطوات ← [نموذج الطلب] ← الضمانات ← الأسئلة ← الطلب */
function CopyPreview({ copy }) {
  const { t } = useI18n();
  if (!copy?.hero) return null;
  const h = copy.hero;
  return (
    <div dir="rtl" lang="ar" className="space-y-4 rounded-xl border border-line bg-raised/40 p-4 text-sm leading-7">
      <div className="space-y-2 text-center">
        {h.eyebrow && <p className="text-xs font-semibold text-brand">{h.eyebrow}</p>}
        <p className="text-lg font-bold leading-snug text-ink">{h.headline}</p>
        {h.subheadline && <p className="text-sub">{h.subheadline}</p>}
        <ul className="mx-auto max-w-sm space-y-1 text-start">
          {h.bullets.map((b) => (
            <li key={b}>✓ {b}</li>
          ))}
        </ul>
        <span className="inline-block rounded-lg bg-brand px-4 py-2 font-semibold text-white">{h.cta}</span>
        {h.note && <p className="text-xs text-muted">{h.note}</p>}
      </div>
      {copy.story.map((s) => (
        <div key={s.heading + s.stage}>
          <p className="font-semibold text-ink">
            {s.heading} <span className="ltr text-[11px] font-normal text-muted">· {s.stage}</span>
          </p>
          <p className="whitespace-pre-line text-sub">{s.body}</p>
        </div>
      ))}
      {copy.benefits.items.length > 0 && (
        <div>
          <p className="font-semibold text-ink">{copy.benefits.heading}</p>
          <ul className="space-y-1">
            {copy.benefits.items.map((b) => (
              <li key={b.title}>
                <b>{b.title}</b> — <span className="text-sub">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {copy.steps.items.length > 0 && (
        <div>
          <p className="font-semibold text-ink">{copy.steps.heading}</p>
          <ol className="list-decimal space-y-1 ps-5">
            {copy.steps.items.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      <p className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-muted">{t(['هنا نموذج الطلب نفسه الذي في صفحة المنتج: الألوان، العروض، الولايات، الدفع عند الاستلام', 'Ici le formulaire de la fiche produit : couleurs, offres, wilayas, paiement à la livraison'])}</p>
      {copy.guarantee.items.length > 0 && (
        <div>
          <p className="font-semibold text-ink">{copy.guarantee.heading}</p>
          <ul className="space-y-1">
            {copy.guarantee.items.map((g) => (
              <li key={g}>✓ {g}</li>
            ))}
          </ul>
        </div>
      )}
      {copy.faq.length > 0 && (
        <div className="space-y-1">
          {copy.faq.map((f) => (
            <details key={f.q} className="rounded-lg bg-surface px-3 py-2">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="text-sub">{f.a}</p>
            </details>
          ))}
        </div>
      )}
      <p className="text-center font-semibold text-ink">{copy.final_cta.headline}</p>
    </div>
  );
}

/** المولّد: منتج + زاوية + إطار + لهجة → مسودة (Claude) */
function GenerateModal({ onClose, onDone, base, meta }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products');
  const list = useMemo(() => (products.data || []).filter((p) => p.handle && p.shopify_id && p.stage !== 'archived'), [products.data]);
  const [f, setF] = useState({ product_id: '', angle: '', framework: 'aida', tone: 'ar', audience: '', slug: '', instructions: '' });
  const product = list.find((p) => String(p.id) === String(f.product_id));
  // نفس قاعدة الخادم: مقبض لاتيني + زاوية جاهزة؛ غير ذلك يقترحه Claude ويمكن تعديله قبل النشر
  const preset = (meta?.angles || []).find(([ar]) => ar === f.angle);
  const handlePart = /^[a-z0-9-]+$/.test(product?.handle || '') ? product.handle.split('-').slice(0, 2).join('-') : '';
  const autoSlug = handlePart && preset ? `${handlePart}-${preset[1]}` : '';
  const slug = latin(f.slug);
  const fw = (meta?.frameworks || []).find((x) => x.id === f.framework);
  const generate = () =>
    run('gen', () => api.post('/pages/landing/generate', { ...f, slug }), { success: false }).then((r) => {
      if (r) onDone(r);
    });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Wand2}
      title={t(['إنشاء صفحة هبوط', 'Créer une landing page'])}
      footer={
        <Button variant="primary" icon={Sparkles} loading={busy === 'gen'} disabled={!f.product_id || !f.angle.trim()} onClick={generate}>
          {busy === 'gen' ? t(['Claude يكتب الصفحة… (دقيقة تقريباً)', 'Claude rédige… (≈ 1 min)']) : t(['توليد صفحة الهبوط', 'Générer la landing page'])}
        </Button>
      }
    >
      <div className="grid gap-4">
        <Field label={t(['المنتج', 'Produit'])} hint={t(['صفحة المنتج تبقى للإعلان الرئيسي؛ صفحة الهبوط لزاوية واحدة لجمهور محدد.', 'La fiche produit reste pour la pub principale ; la landing sert un angle précis.'])}>
          <Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })} placeholder="—" options={list.map((p) => ({ value: p.id, label: p.title }))} />
        </Field>
        <Field label={t(['الزاوية التسويقية', 'Angle marketing'])} hint={t(['نفس الزاوية التي سيُبنى عليها الإعلان: العنوان يطابقها.', 'Le même angle que la pub : le titre y correspond.'])}>
          <Input value={f.angle} onChange={(e) => setF({ ...f, angle: e.target.value })} placeholder={t(['مثال: هدية لطفلك قبل الدخول المدرسي', 'Ex. : cadeau pour la rentrée'])} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(meta?.angles || []).map(([ar]) => (
              <button key={ar} type="button" className={cx('chip', f.angle === ar ? 'bg-brand text-white' : 'bg-raised')} onClick={() => setF({ ...f, angle: ar })}>
                {ar}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t(['إطار الكتابة', 'Structure de rédaction'])}>
          <div className="grid gap-2 sm:grid-cols-2">
            {(meta?.frameworks || []).map((x) => (
              <label key={x.id} className={cx('flex cursor-pointer gap-2 rounded-lg border p-3 text-sm', f.framework === x.id ? 'border-brand bg-brand/5' : 'border-line')}>
                <input type="radio" name="lp-framework" className="mt-1" checked={f.framework === x.id} onChange={() => setF({ ...f, framework: x.id })} />
                <span>
                  <b className="block text-ink">{t(x.label)}</b>
                  <span className="text-xs text-muted">{t(x.when)}</span>
                </span>
              </label>
            ))}
          </div>
          {fw && <p className="mt-1 text-xs text-muted">{t(['القاعدة الثابتة في كل الأطر: لا أرقام ولا آراء ولا ندرة مختلقة؛ العروض والسياسات كما في صفحة المنتج.', 'Règle fixe : aucun chiffre, avis ou rareté inventés ; offres et politiques identiques à la fiche.'])}</p>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(['اللغة', 'Langue'])}>
            <Segmented
              size="sm"
              value={f.tone}
              onChange={(tone) => setF({ ...f, tone })}
              options={[
                { value: 'ar', label: t(['عربية مبسطة', 'Arabe simple']) },
                { value: 'darija', label: t(['دارجة جزائرية', 'Darija']) },
              ]}
            />
          </Field>
          <Field label={t(['الجمهور (اختياري)', 'Audience (facultatif)'])}>
            <Input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder={t(['أمهات أطفال المدارس', 'Mamans d’écoliers'])} />
          </Field>
        </div>
        <Field label={t(['رابط الصفحة', 'Lien de la page'])} hint={t(['يُكتب تلقائياً (المنتج-الزاوية)، ويمكنك تعديله. Shopify لا يقبل «/» ثانية داخل اسم الصفحة.', 'Généré (produit-angle), modifiable. Shopify n’accepte pas de « / » dans le nom.'])}>
          <div className="ltr flex items-center gap-1 rounded-lg border border-line bg-raised px-2">
            <span className="shrink-0 text-xs text-muted">{hostOf(base) || 'store'}/pages/</span>
            <input className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" aria-label={t(['رابط الصفحة', 'Lien de la page'])} value={f.slug || ''} placeholder={autoSlug || t(['يقترحه Claude، وتعدّله قبل النشر', 'proposé par Claude, modifiable'])} onChange={(e) => setF({ ...f, slug: e.target.value })} />
          </div>
        </Field>
        <Field label={t(['تعليمات إضافية (اختياري)', 'Consignes (facultatif)'])}>
          <Textarea value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder={t(['مثال: ركّز على سهولة التنظيف', 'Ex. : insister sur le nettoyage facile'])} />
        </Field>
      </div>
    </Modal>
  );
}

/** معاينة المسودة/الصفحة + النشر والسحب */
function LandingModal({ item, base, onClose, onChanged }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [l, setL] = useState(item);
  const [slug, setSlug] = useState(item.slug);
  const publicUrl = l.public_url || `${base || ''}/pages/${l.slug}`;
  const act = (key, fn, success) =>
    run(key, fn, { success }).then((r) => {
      if (r) {
        setL(r.id ? r : l);
        onChanged();
      }
      return r;
    });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Eye}
      title={`${l.product_title} · ${l.angle}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {l.status !== 'published' && (
              <Button variant="ghost" icon={Trash2} loading={busy === 'del'} onClick={() => act('del', () => api.del(`/pages/landing/${l.id}`), t(['حُذفت المسودة', 'Brouillon supprimé'])).then((r) => r && onClose())}>
                {t('c.delete')}
              </Button>
            )}
            {l.status === 'published' && (
              <Button variant="ghost" icon={CloudOff} loading={busy === 'off'} onClick={() => act('off', () => api.post(`/pages/landing/${l.id}/unpublish`, {}), t(['سُحبت الصفحة من المتجر', 'Page retirée']))}>
                {t(['سحب من المتجر', 'Retirer'])}
              </Button>
            )}
          </div>
          <Button variant="primary" icon={Rocket} loading={busy === 'pub'} onClick={() => act('pub', () => api.post(`/pages/landing/${l.id}/publish`, {}), t(['نُشرت الصفحة على المتجر', 'Page publiée']))}>
            {l.status === 'published' ? t(['إعادة النشر', 'Republier']) : t(['نشر على المتجر', 'Publier sur la boutique'])}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STATUS[l.status][2]}>{t(STATUS[l.status])}</Badge>
          <Badge>{l.framework.toUpperCase()}</Badge>
          <span className="ltr min-w-0 flex-1 truncate text-xs text-sub">{publicUrl}</span>
          <CopyButton text={publicUrl} />
          {l.status === 'published' && (
            <a className="btn btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> {t(['فتح', 'Ouvrir'])}
            </a>
          )}
        </div>
        {l.status !== 'published' && (
          <div className="ltr flex items-center gap-1 rounded-lg border border-line bg-raised px-2">
            <span className="shrink-0 text-xs text-muted">{hostOf(base) || 'store'}/pages/</span>
            <input className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" aria-label={t(['رابط الصفحة', 'Lien de la page'])} value={slug} onChange={(e) => setSlug(e.target.value)} />
            <Button size="sm" disabled={!latin(slug) || latin(slug) === l.slug} loading={busy === 'slug'} onClick={() => act('slug', () => api.patch(`/pages/landing/${l.id}`, { slug: latin(slug) }), t(['حُفظ الرابط', 'Lien enregistré'])).then((r) => r && setSlug(r.slug))}>
              {t('c.save')}
            </Button>
          </div>
        )}
        {l.status === 'published' && (
          <p className="rounded-lg bg-good/10 p-3 text-xs leading-6 text-sub">
            {t(['ضع هذا الرابط في حملة الزاوية نفسها. كل طلبية منه تُنسب لهذه الصفحة في «صفحات المتجر». لمقارنتها بصفحة المنتج:', 'Mettez ce lien dans la campagne de cet angle. Pour la comparer à la fiche produit :'])}{' '}
            <Link to="/splits" className="font-semibold text-brand underline">
              <Split className="inline h-3.5 w-3.5" /> {t(['اختبار A/B', 'Test A/B'])}
            </Link>
          </p>
        )}
        {l.copy.owner_todo?.length > 0 && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
            <b className="text-ink">{t(['ما يحتاج منك (لم يختلقه Claude):', 'À compléter (non inventé par Claude) :'])}</b>
            <ul dir="rtl" lang="ar" className="list-disc ps-5 text-sub">
              {l.copy.owner_todo.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        <CopyPreview copy={l.copy} />
        <p className="text-xs text-muted">{t(['بعد النشر، كل نص قابل للتعديل من Shopify: المتجر الإلكتروني ← القوالب ← تخصيص ← قالب المنتج «lp-…».', 'Après publication, tout se modifie dans Shopify : Thèmes → Personnaliser → modèle produit « lp-… ».'])}</p>
      </div>
    </Modal>
  );
}

export default function LandingPages() {
  const { t } = useI18n();
  const { isAll } = useApp();
  const { data, error, loading, reload } = useApi('/pages/landing');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const rows = data?.rows || [];
  return (
    <Card
      icon={Wand2}
      title={t(['صفحات الهبوط', 'Landing pages'])}
      subtitle={t(['صفحة بيع لمنتج واحد وزاوية واحدة، دون قائمة ولا تذييل، بنموذج الطلب نفسه — لكل حملة زاويتها.', 'Une page de vente par produit et par angle, sans menu ni pied de page, avec le même formulaire.'])}
      actions={
        <Button variant="primary" icon={Sparkles} disabled={isAll} title={isAll ? t(['اختر مشروعاً أولاً', 'Choisissez un projet']) : undefined} onClick={() => setCreating(true)}>
          {t(['إنشاء صفحة هبوط', 'Créer une landing'])}
        </Button>
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !rows.length ? (
        <Empty icon={Wand2} title={t(['لا صفحات هبوط بعد', 'Aucune landing page'])}>
          {t(['اختر منتجاً وزاوية (هدية، المشكلة والحل…) وإطاراً (AIDA، PAS…)، ويكتب Claude الصفحة بقواعد واضحة دون اختلاق.', 'Choisissez produit, angle et structure (AIDA, PAS…) : Claude rédige selon des règles strictes.'])}
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setOpen(l)}>
                <span className="block truncate font-medium text-ink">
                  {l.product_title} · {l.angle}
                </span>
                <span className="ltr block truncate text-xs text-muted">/pages/{l.slug}</span>
              </button>
              <Badge>{l.framework.toUpperCase()}</Badge>
              <Badge tone={STATUS[l.status][2]}>{t(STATUS[l.status])}</Badge>
              {l.public_url && l.status === 'published' && <CopyButton text={l.public_url} />}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <GenerateModal
          base={data?.base}
          meta={data}
          onClose={() => setCreating(false)}
          onDone={(l) => {
            setCreating(false);
            reload(true);
            setOpen(l);
          }}
        />
      )}
      {open && <LandingModal item={open} base={data?.base} onClose={() => setOpen(null)} onChanged={() => reload(true)} />}
    </Card>
  );
}
