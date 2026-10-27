import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CloudOff, ExternalLink, Eye, ImageOff, ImagePlus, Images, Pencil, Rocket, Settings, Sparkles, Split, Trash2, Wand2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useApp } from './ProjectContext.jsx';
import DeliveryCard from './DeliveryCard.jsx';
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, Textarea, Toggle, cx, useAction } from './ui.jsx';

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

const KINDS = {
  hero: ['الصورة الرئيسية', 'Visuel principal'],
  design: ['التصميم', 'Design'],
  detail: ['تفصيل قريب', 'Détail'],
  feature: ['ميزة', 'Atout'],
  in_use: ['أثناء الاستعمال', 'En utilisation'],
  size: ['الحجم', 'Taille'],
  variants: ['الألوان والموديلات', 'Coloris'],
};

/** لقطة واحدة: الصورة (أو مشهدها قبل الرسم)، عنوانها ونقاطها، الرسم/إعادة الرسم، الإظهار في الصفحة، التعديل */
function VisualCard({ v, busy, disabled, onDraw, onPatch }) {
  const { t } = useI18n();
  const [edit, setEdit] = useState(null);
  const drawing = busy === `v-${v.id}`;
  return (
    <li className={cx('flex flex-col overflow-hidden rounded-xl border bg-surface', v.image && !v.approved ? 'border-dashed border-line opacity-60' : 'border-line')}>
      <div className="relative aspect-[4/5] bg-raised">
        {v.image ? (
          <img src={v.image} alt={v.headline} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center p-3 text-center text-xs text-muted">
            <span className="grid justify-items-center gap-1.5">
              <ImageOff className="h-6 w-6" aria-hidden />
              {t(['لم تُرسم بعد', 'Pas encore dessiné'])}
            </span>
          </div>
        )}
        <span className="absolute start-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-ink">{t(KINDS[v.kind] || KINDS.feature)}</span>
        {v.image && v.drawn_with_text && <span className="absolute end-2 top-2 rounded-full bg-warn px-2 py-0.5 text-[11px] font-medium text-white">{t(['بالكتابة', 'Avec texte'])}</span>}
        {drawing && (
          <div className="absolute inset-0 grid place-items-center bg-surface/70">
            <Loading />
          </div>
        )}
      </div>
      {edit ? (
        <div className="grid gap-2 p-2.5">
          <Input value={edit.headline} maxLength={90} aria-label={t(['العنوان', 'Titre'])} onChange={(e) => setEdit({ ...edit, headline: e.target.value })} />
          <Textarea className="min-h-[60px] text-xs" value={edit.points} aria-label={t(['النقاط (سطر لكل نقطة)', 'Points (un par ligne)'])} onChange={(e) => setEdit({ ...edit, points: e.target.value })} />
          <Textarea dir="ltr" className="min-h-[70px] text-xs" value={edit.scene} aria-label={t(['المشهد (لمولّد الصور، بالإنجليزية)', 'Scène (pour le générateur, en anglais)'])} onChange={(e) => setEdit({ ...edit, scene: e.target.value })} />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => onPatch({ headline: edit.headline, points: edit.points, scene: edit.scene }).then((r) => r && setEdit(null))}>
              {t('c.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {t('c.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div dir="rtl" lang="ar" className="flex-1 space-y-1 p-2.5">
          <p className="text-sm font-semibold leading-6 text-ink">{v.headline}</p>
          {v.points.length > 0 && <p className="text-xs leading-5 text-sub">{v.points.join(' · ')}</p>}
          {v.kind !== 'hero' && (
            <div dir="auto" className="pt-1 text-xs">
              <Toggle checked={Boolean(v.with_text)} onChange={(on) => onPatch({ with_text: on })} label={t(['العنوان داخل الصورة (تجربة)', 'Titre dans l’image (essai)'])} />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line p-2">
        <Button size="sm" icon={ImagePlus} loading={drawing} disabled={disabled || Boolean(busy)} onClick={onDraw}>
          {v.image ? t(['أعد الرسم', 'Redessiner']) : t(['ارسم', 'Dessiner'])}
        </Button>
        {!edit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t(['تعديل', 'Modifier'])} title={t(['تعديل', 'Modifier'])} onClick={() => setEdit({ headline: v.headline, points: v.points.join('\n'), scene: v.scene })} />}
        {v.image && <Toggle checked={v.approved} onChange={(on) => onPatch({ approved: on })} label={t(['في الصفحة', 'Dans la page'])} />}
      </div>
    </li>
  );
}

/** الصور الوصفية: خطة Claude ← رسم من صور المنتج الحقيقية ← مراجعة ← تُرفع إلى Shopify عند النشر */
function VisualsPanel({ l, setL, onChanged }) {
  const { t, err } = useI18n();
  const { run, busy } = useAction();
  const [progress, setProgress] = useState(null);
  // خطأ الإعداد (المفتاح، الفوترة) يبقى ظاهراً داخل اللوحة حتى ينجح رسم، لا رسالة تختفي بعد ثوانٍ
  const [failure, setFailure] = useState(null);
  const list = l.visuals || [];
  const noProvider = l.image_provider === 'none';
  const drawn = list.filter((v) => v.image).length;
  const done = (r) => {
    if (r) setL(r);
    return r;
  };
  const draw = (vid) =>
    run(
      `v-${vid}`,
      () =>
        api.post(`/pages/landing/${l.id}/visuals/${vid}/generate`, {}).then(
          (r) => (setFailure(null), r),
          (e) => (setFailure(e), Promise.reject(e)),
        ),
      { success: false },
    ).then(done);
  const patch = (vid, body) => run(`p-${vid}`, () => api.patch(`/pages/landing/${l.id}/visuals/${vid}`, body), { success: false }).then(done);
  const drawAll = async () => {
    const todo = list.filter((v) => !v.image);
    for (const [i, v] of todo.entries()) {
      setProgress(`${i + 1}/${todo.length}`);
      if (!(await draw(v.id))) break;
    }
    setProgress(null);
    onChanged();
  };
  const plan = () => {
    if (list.length && !window.confirm(t(['خطة جديدة تستبدل اللقطات الحالية (الصور المرسومة تبقى في صور المنتج). متابعة؟', 'Un nouveau plan remplace les visuels actuels. Continuer ?']))) return;
    run('plan', () => api.post(`/pages/landing/${l.id}/visuals/plan`, {}), { success: false }).then(done);
  };
  const pending = l.status === 'published' && list.some((v) => v.approved && v.image && !v.shopify_url);
  return (
    <section className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Images className="h-4 w-4 text-brand" aria-hidden />
        <b className="text-sm text-ink">{t(['الصور الوصفية', 'Visuels descriptifs'])}</b>
        {list.length > 0 && <Badge>{t([`${drawn} من ${list.length} مرسومة`, `${drawn}/${list.length} dessinés`])}</Badge>}
        <span className="flex-1" />
        {list.length > 0 && (
          <Button size="sm" variant="ghost" icon={Sparkles} loading={busy === 'plan'} disabled={Boolean(busy || progress)} onClick={plan}>
            {t(['خطة جديدة', 'Nouveau plan'])}
          </Button>
        )}
        {list.length > drawn && (
          <Button size="sm" variant="primary" icon={ImagePlus} loading={Boolean(progress)} disabled={noProvider || Boolean(busy)} onClick={drawAll}>
            {progress ? t([`الرسم ${progress}…`, `Dessin ${progress}…`]) : t([`ارسم الكل (${list.length - drawn})`, `Tout dessiner (${list.length - drawn})`])}
          </Button>
        )}
      </div>
      <p className="text-xs leading-6 text-sub">
        {t([
          'تُرسم من الصورة الرئيسية للمنتج ووصف صفحته فقط، بأجواء تناسب الزاوية. افتراضياً بلا كتابة داخلها: العنوان والنقاط نص حيّ في الصفحة. لتجربة الكتابة فعّل «العنوان داخل الصورة» على لقطة واحدة وارسمها: إن خرجت الحروف العربية سليمة اعتمدها، وإن أخطأت فأطفئ الخيار وأعد الرسم. راجع كل صورة: إن غيّرت شكل المنتج أو لونه فأخفها أو أعد رسمها، لأن الزبون يرفض الطرد إن لم يطابق ما رآه.',
          'Dessinés à partir de la photo principale et de la description du produit, dans l’ambiance de l’angle. Par défaut sans texte dans l’image. Pour essayer le texte : activez « titre dans l’image » sur un visuel et dessinez-le ; si l’arabe est faux, désactivez et redessinez. Un produit modifié = colis refusé.',
        ])}
      </p>
      {noProvider && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-warn/10 p-3 text-xs leading-6 text-sub">
          {t(['لرسم الصور: اختر مزوّد الصور (Gemini) وأدخل مفتاحه في الإعدادات.', 'Pour dessiner : choisissez un fournisseur d’images (Gemini) et sa clé dans Paramètres.'])}
          <Link to="/settings" className="inline-flex items-center gap-1 font-semibold text-brand underline">
            <Settings className="h-3.5 w-3.5" aria-hidden /> {t(['الإعدادات', 'Paramètres'])}
          </Link>
        </p>
      )}
      {failure && (
        <p role="alert" className="flex gap-2 rounded-lg border border-bad/30 bg-bad/10 p-3 text-xs leading-6 text-ink">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-bad" aria-hidden />
          <span className="min-w-0 break-words">{err(failure)}</span>
        </p>
      )}
      {pending && <p className="rounded-lg bg-brand/10 p-2.5 text-xs text-sub">{t(['صور جديدة لم تُنشر بعد: اضغط «إعادة النشر».', 'Nouveaux visuels pas encore publiés : republiez.'])}</p>}
      {!list.length ? (
        <Button icon={Sparkles} loading={busy === 'plan'} onClick={plan}>
          {t(['اقترح صوراً وصفية لهذه الصفحة', 'Proposer des visuels pour cette page'])}
        </Button>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((v) => (
            <VisualCard key={v.id} v={v} busy={busy} disabled={noProvider || Boolean(progress)} onDraw={() => draw(v.id)} onPatch={(body) => patch(v.id, body)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** المولّد: منتج + زاوية + إطار + لهجة → مسودة (Claude) */
function GenerateModal({ onClose, onDone, base, meta }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products');
  const list = useMemo(() => (products.data || []).filter((p) => p.handle && p.shopify_id && p.stage !== 'archived'), [products.data]);
  const [f, setF] = useState({ product_id: '', angle: '', framework: 'aida', layout: '', tone: 'ar', audience: '', slug: '', instructions: '' });
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
          {busy === 'gen' ? t(['Claude يكتب الصفحة ويخطط صورها… (دقيقة تقريباً)', 'Claude rédige et planifie les visuels… (≈ 1 min)']) : t(['توليد صفحة الهبوط', 'Générer la landing page'])}
        </Button>
      }
    >
      <div className="grid gap-4">
        {meta?.delivery && !meta.delivery.imported_at && (
          <p className="rounded-lg bg-warn/10 p-3 text-xs leading-6 text-sub">
            {t(['أسعار التوصيل والسياسات لم تُستورد بعد (بطاقة «التوصيل والسياسات»): الصفحة ستُكتب دونها، وتظهر في «ما يحتاج منك».', 'Livraison et politiques pas encore importées : la page sera rédigée sans.'])}
          </p>
        )}
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
        <Field
          label={t(['تصميم الصفحة', 'Design de la page'])}
          hint={t(['لكل زاوية ترتيب أقسام وألوان وصور مختلفة. «تلقائي» يختاره من كلمات الزاوية (هدية، المشكلة والحل، الاستعمال اليومي…).', 'Chaque angle a ses sections, couleurs et visuels. « Auto » le choisit d’après l’angle.'])}
        >
          <Select value={f.layout} onChange={(e) => setF({ ...f, layout: e.target.value })} placeholder={t(['تلقائي حسب الزاوية', 'Auto selon l’angle'])} options={(meta?.layouts || []).map((x) => ({ value: x.id, label: t(x.label) }))} />
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
function LandingModal({ item, base, layouts = [], onClose, onChanged }) {
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
          {l.copy?.layout && <Badge tone="info">{t(layouts.find((x) => x.id === l.copy.layout)?.label || [l.copy.layout, l.copy.layout])}</Badge>}
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
        <VisualsPanel l={l} setL={setL} onChanged={onChanged} />
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
    <>
      <DeliveryCard onChange={() => reload(true)} />
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
                  <span className="block truncate font-medium text-ink">{l.angle}</span>
                  <span className="block truncate text-xs text-sub">{l.product_title}</span>
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
        {open && <LandingModal item={open} base={data?.base} layouts={data?.layouts} onClose={() => setOpen(null)} onChanged={() => reload(true)} />}
      </Card>
    </>
  );
}
