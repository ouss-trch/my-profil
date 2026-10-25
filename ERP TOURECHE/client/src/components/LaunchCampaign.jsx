import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Image as ImageIcon, Rocket, Save, ShieldAlert, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { api } from '../lib/api.js';
import { da, money, n0 } from '../lib/format.js';
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, Textarea, Toggle, cx, useAction } from './ui.jsx';
import PageSuggest from './PageSuggest.jsx';

const CTAS = ['SHOP_NOW', 'ORDER_NOW', 'BUY_NOW', 'LEARN_MORE', 'GET_OFFER', 'SEND_MESSAGE'];
const ACCOUNT_STATUS = { 1: ['نشط', 'Actif', 'good'], 2: ['معطّل', 'Désactivé', 'bad'], 3: ['غير مسدد', 'Impayé', 'bad'], 7: ['قيد المراجعة', 'En revue', 'warn'], 9: ['فترة سماح', 'Grâce', 'warn'], 101: ['مغلق', 'Fermé', 'bad'] };

/** محوّل العملة: كم ديناراً تساوي ميزانية يومية بعملة الحساب */
const hostOf = (link) => {
  try {
    return new URL(link.startsWith('http') ? link : `https://${link}`).hostname;
  } catch {
    return '—';
  }
};
const toDa = (amount, currency, fx) => (currency === 'DZD' ? amount : currency === 'EUR' ? amount * (fx?.eur || 270) : amount * (fx?.usd || 250));

/**
 * إطلاق حملة Meta لأي منتج (منشأ في الـ ERP أو قادم من Shopify).
 * - الحملة تُنشأ متوقفة (PAUSED) للمراجعة؛ التفعيل الفوري اختياري ويتطلب كلمة المرور الحساسة
 * - الميزانية يحددها المستخدم دائماً
 * - الإعدادات الأخيرة تُحفظ تلقائياً كافتراضية للمشروع، ويمكن الحفظ كمسودة دون أي اتصال بـ Meta
 */
export default function LaunchCampaign({ productId, projectId, open, onClose, draft: initialDraft }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const opt = { project: projectId };
  const [ctx, setCtx] = useState(null);
  const [bm, setBm] = useState(null);
  const [assets, setAssets] = useState({ pages: [], pixels: [] });
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [f, setF] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [done, setDone] = useState(null);
  const [confirmActivate, setConfirmActivate] = useState(false);

  useEffect(() => {
    if (!open || !productId) return;
    setCtx(null);
    setDone(null);
    setError(null);
    setDraftId(initialDraft?.id || null);
    Promise.all([api.get(`/ads/launch/${productId}`, opt), api.get('/ads/businesses', opt).catch((e) => ({ configured: false, error: e }))])
      .then(([c, b]) => {
        setCtx(c);
        setBm(b);
        const d = c.defaults || {};
        const firstCopy = c.ad_copy?.variants?.[0];
        const base = {
          business_id: b?.selected_business || '',
          account_id: d.account_id || '',
          page_id: d.page_id || '',
          pixel_id: d.pixel_id || '',
          platforms: d.platforms?.length ? d.platforms : ['facebook', 'instagram'],
          countries: d.countries?.length ? d.countries : ['DZ'],
          age_min: d.age_min || 18,
          age_max: d.age_max || '',
          genders: d.genders || [],
          daily_budget: '',
          test_budget_da: '',
          cta: d.cta || 'SHOP_NOW',
          source: 'image',
          image_url: c.product.images?.[0]?.url || '',
          post_id: '',
          ig_media_id: '',
          primary_text: firstCopy?.primary_text || '',
          headline: firstCopy?.headline || c.product.title.slice(0, 40),
          description: firstCopy?.description || '',
          link: c.link || '',
          name: '',
          activate: false,
        };
        setF(initialDraft ? { ...base, ...initialDraft.payload } : base);
        // الحساب المحفوظ يحدد الـ BM تلقائياً
        if (!base.business_id && d.account_id && b?.businesses) {
          const owner = b.businesses.find((x) => x.accounts.some((a) => a.id === String(d.account_id)));
          if (owner) setF((x) => ({ ...x, business_id: owner.id || 'none' }));
        }
      })
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  useEffect(() => {
    if (!f?.account_id || !open) return;
    api.get(`/ads/accounts/${f.account_id}/assets`, opt).then(setAssets, () => setAssets({ pages: [], pixels: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.account_id, open]);

  useEffect(() => {
    if (!open || !f || f.source === 'image' || posts) return;
    api.get('/ads/posts', opt).then(setPosts, () => setPosts({ facebook: [], instagram: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.source, open]);

  const businesses = bm?.businesses || [];
  const accounts = useMemo(() => {
    if (!businesses.length) return [];
    const g = businesses.find((b) => (b.id || 'none') === f?.business_id);
    return g ? g.accounts : businesses.flatMap((b) => b.accounts);
  }, [businesses, f?.business_id]);
  const account = accounts.find((a) => a.id === String(f?.account_id)) || businesses.flatMap((b) => b.accounts).find((a) => a.id === String(f?.account_id));
  const currency = account?.currency || 'USD';
  const dailyDa = f?.daily_budget ? toDa(Number(f.daily_budget), currency, ctx?.fx) : null;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const payload = () => ({
    account_id: f.account_id,
    page_id: f.page_id || undefined,
    pixel_id: f.pixel_id || 'none',
    platforms: f.platforms,
    countries: f.countries,
    age_min: Number(f.age_min) || 18,
    age_max: f.age_max ? Number(f.age_max) : undefined,
    genders: f.genders,
    daily_budget: f.daily_budget ? Number(f.daily_budget) : undefined,
    test_budget_da: f.test_budget_da ? Number(f.test_budget_da) : undefined,
    image_url: f.source === 'image' ? f.image_url : undefined,
    post_id: f.source === 'fb_post' ? f.post_id : undefined,
    ig_media_id: f.source === 'ig_post' ? f.ig_media_id : undefined,
    primary_text: f.primary_text,
    headline: f.headline,
    description: f.description,
    cta: f.cta,
    link: f.link || undefined,
    name: f.name || undefined,
    draft_id: draftId || undefined,
  });

  const problems = [];
  if (f) {
    if (!f.account_id) problems.push(t(['اختر الحساب الإعلاني', 'Choisissez le compte publicitaire']));
    if (!f.page_id) problems.push(t(['اختر صفحة فيسبوك', 'Choisissez la page Facebook']));
    if (!(Number(f.daily_budget) >= 1)) problems.push(t(['حدد الميزانية اليومية', 'Indiquez le budget journalier']));
    if (!f.link && f.source !== 'fb_post') problems.push(t(['رابط المنتج مفقود (انشر المنتج أو ضع رابطاً)', 'Lien produit manquant (publiez ou saisissez un lien)']));
    if (f.source === 'image' && !f.image_url) problems.push(t(['اختر صورة', 'Choisissez une image']));
    if (f.source === 'fb_post' && !f.post_id) problems.push(t(['اختر منشوراً', 'Choisissez une publication']));
    if (f.source === 'ig_post' && !f.ig_media_id) problems.push(t(['اختر منشور إنستغرام', 'Choisissez une publication Instagram']));
    if (f.source === 'image' && !f.primary_text?.trim()) problems.push(t(['اكتب النص الأساسي', 'Rédigez le texte principal']));
  }

  const saveDraft = async () => {
    const r = await run('draft', () => api.post('/ads/drafts', { id: draftId, product_id: productId, name: f.name || `${ctx.product.title.slice(0, 40)} · draft`, payload: { ...f } }, opt), { success: t(['حُفظت المسودة', 'Brouillon enregistré']) });
    if (r) setDraftId(r.id);
  };
  const launch = async (activate) => {
    const r = await run('launch', () => api.post(`/ads/tests/${productId}/launch`, { ...payload(), activate }, { ...opt, reason: activate ? t(['تفعيل الحملة يبدأ الصرف من حسابك الإعلاني.', 'Activer la campagne commence la dépense.']) : undefined }), { success: false });
    if (r) setDone(r);
    setConfirmActivate(false);
  };

  return (
    <Modal open={open} onClose={() => onClose(Boolean(done))} title={t(['إطلاق حملة إعلانية', 'Lancer une campagne'])} icon={Rocket} size="xl">
      {error && <ErrorBox error={error} />}
      {!ctx && !error && <Loading />}
      {ctx && f && done && (
        <div className="space-y-4 py-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-good" />
          <h3 className="text-lg font-semibold">
            {done.activated ? t(['الحملة مفعّلة الآن', 'Campagne activée']) : t(['أُنشئت الحملة متوقفة — جاهزة للمراجعة', 'Campagne créée en pause — prête à être revue'])}
          </h3>
          <p className="text-sm text-sub">
            {done.name} · {money(done.daily_budget, done.currency)} / {t(['يوم', 'jour'])}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <a className="btn btn-primary" href={done.ads_manager_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t(['فتح في Ads Manager', 'Ouvrir dans Ads Manager'])}
            </a>
            <Button onClick={() => onClose(true)}>{t('c.close')}</Button>
          </div>
          {!done.activated && <p className="text-xs text-muted">{t(['لتفعيلها: من صفحة الإعلانات ← الحملات ← «تفعيل» (يطلب كلمة المرور الحساسة).', 'Pour l’activer : Pubs → Campagnes → « Activer » (mot de passe sensible).'])}</p>}
        </div>
      )}
      {ctx && f && !done && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-lg bg-raised p-3">
              {ctx.product.images?.[0]?.url && <img src={ctx.product.images[0].url} alt="" className="h-14 w-14 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{ctx.product.title}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
                  <span>{da(ctx.product.price)}</span>
                  {ctx.published ? <Badge tone="good">Shopify</Badge> : <Badge tone="warn">{t(['غير منشور على المتجر', 'Non publié'])}</Badge>}
                  {ctx.break_even && (
                    <span>
                      {t(['حد التعادل لكل طلبية مسلّمة:', 'Seuil par commande livrée :'])} <b className="text-ink">{da(ctx.break_even.da)}</b>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {ctx.drafts?.some((d) => d.status === 'draft') && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <FileText className="h-4 w-4 text-muted" />
                <span className="text-sub">{t(['مسودات محفوظة:', 'Brouillons :'])}</span>
                {ctx.drafts
                  .filter((d) => d.status === 'draft')
                  .slice(0, 6)
                  .map((d) => (
                    <Button
                      key={d.id}
                      size="sm"
                      variant={draftId === d.id ? 'primary' : undefined}
                      onClick={() => {
                        setDraftId(d.id);
                        setF((x) => ({ ...x, ...d.payload }));
                      }}
                    >
                      {d.name}
                    </Button>
                  ))}
              </div>
            )}

            <Section n="1" title={t(['الحساب والصفحة', 'Compte & page'])}>
              {!bm?.configured && <ErrorBox error={bm?.error || { code: 'meta_not_configured' }} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Business Manager">
                  <Select
                    value={f.business_id}
                    onChange={(e) => set({ business_id: e.target.value, account_id: '' })}
                    placeholder={t(['كل الحسابات', 'Tous les comptes'])}
                    options={businesses.map((b) => ({ value: b.id || 'none', label: b.name || t(['حسابات شخصية', 'Comptes personnels']) }))}
                  />
                </Field>
                <Field label={t(['الحساب الإعلاني', 'Compte publicitaire'])}>
                  <Select
                    value={f.account_id}
                    onChange={(e) => set({ account_id: e.target.value, page_id: f.page_id, pixel_id: '' })}
                    placeholder={t('c.select')}
                    options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}${a.status !== 1 ? ` · ${t(ACCOUNT_STATUS[a.status] || ['?', '?'])}` : ''}`, disabled: a.status !== 1 }))}
                  />
                </Field>
                <Field label={t(['صفحة فيسبوك', 'Page Facebook'])}>
                  <Select
                    value={f.page_id}
                    onChange={(e) => set({ page_id: e.target.value })}
                    placeholder={t('c.select')}
                    options={[...assets.pages, ...(f.page_id && !assets.pages.some((p) => p.id === f.page_id) ? [{ id: f.page_id, name: f.page_id }] : [])].map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
                <Field label={t(['البيكسل (هدف المبيعات)', 'Pixel (objectif ventes)'])} hint={!f.pixel_id || f.pixel_id === 'none' ? t(['دون بيكسل تصبح الحملة «زيارات» وليس «مبيعات»', 'Sans pixel : objectif trafic au lieu de ventes']) : null}>
                  <Select
                    value={f.pixel_id}
                    onChange={(e) => set({ pixel_id: e.target.value })}
                    options={[{ value: 'none', label: t(['بدون بيكسل', 'Sans pixel']) }, ...assets.pixels.map((p) => ({ value: p.id, label: `${p.name}${p.last_fired_time ? '' : ' · ⚠'}` })), ...(f.pixel_id && f.pixel_id !== 'none' && !assets.pixels.some((p) => p.id === f.pixel_id) ? [{ value: f.pixel_id, label: f.pixel_id }] : [])]}
                  />
                </Field>
              </div>
            </Section>

            <Section n="2" title={t(['الميزانية — قرارك أنت', 'Budget — votre décision'])}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t(['الميزانية اليومية ({c})', 'Budget journalier ({c})'], { c: currency })} hint={dailyDa ? `≈ ${da(dailyDa)} / ${t(['يوم', 'jour'])} · ${t(['3 أيام', '3 jours'])} ≈ ${da(dailyDa * 3)}` : t(['لا توجد قيمة افتراضية: اكتب المبلغ الذي تقرره', 'Aucune valeur par défaut : saisissez votre montant'])}>
                  <Input type="number" min="1" step="0.5" value={f.daily_budget} onChange={(e) => set({ daily_budget: e.target.value })} placeholder="0" className="num" />
                </Field>
                <Field label={t(['ميزانية الاختبار الكلية (دج) — للمتابعة', 'Budget total du test (DA) — suivi'])} hint={t(['المستشار ينبّهك عند صرفها دون نتيجة واضحة', 'Le conseiller vous alerte si dépensé sans verdict'])}>
                  <Input type="number" min="0" value={f.test_budget_da} onChange={(e) => set({ test_budget_da: e.target.value })} className="num" />
                </Field>
              </div>
              {ctx.break_even && dailyDa ? (
                <p className="mt-2 text-xs text-sub">
                  {t(['لتبقى رابحاً يجب أن تجلب هذه الميزانية طلبية مسلّمة واحدة على الأقل كل {x} دج إنفاق.', 'Pour rester rentable, il faut au moins 1 commande livrée par {x} DA dépensés.'], { x: n0(ctx.break_even.da) })}{' '}
                  {t(['أي ≈ {n} طلبية مسلّمة يومياً.', 'Soit ≈ {n} livrée(s) / jour.'], { n: (dailyDa / Math.max(1, ctx.break_even.da)).toFixed(1) })}
                </p>
              ) : null}
            </Section>

            <Section n="3" title={t(['الجمهور', 'Audience'])}>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label={t(['المنصات', 'Plateformes'])} className="sm:col-span-2">
                  <Segmented
                    value={f.platforms.length === 2 ? 'both' : f.platforms[0]}
                    onChange={(v) => set({ platforms: v === 'both' ? ['facebook', 'instagram'] : [v] })}
                    options={[
                      { value: 'both', label: 'FB + IG' },
                      { value: 'facebook', label: 'Facebook' },
                      { value: 'instagram', label: 'Instagram' },
                    ]}
                  />
                </Field>
                <Field label={t(['الجنس', 'Genre'])} className="sm:col-span-2">
                  <Segmented
                    value={f.genders.length === 1 ? String(f.genders[0]) : 'all'}
                    onChange={(v) => set({ genders: v === 'all' ? [] : [Number(v)] })}
                    options={[
                      { value: 'all', label: t(['الكل', 'Tous']) },
                      { value: '2', label: t(['نساء', 'Femmes']) },
                      { value: '1', label: t(['رجال', 'Hommes']) },
                    ]}
                  />
                </Field>
                <Field label={t(['العمر من', 'Âge min'])}>
                  <Input type="number" min="18" max="65" value={f.age_min} onChange={(e) => set({ age_min: e.target.value })} />
                </Field>
                <Field label={t(['إلى', 'Âge max'])}>
                  <Input type="number" min="18" max="65" value={f.age_max} onChange={(e) => set({ age_max: e.target.value })} placeholder="65+" />
                </Field>
                <Field label={t(['الدول', 'Pays'])} className="sm:col-span-2" hint={t(['Advantage+ يوسّع الجمهور تلقائياً داخل هذه الدول', 'Advantage+ élargit l’audience dans ces pays'])}>
                  <Input className="ltr" value={f.countries.join(',')} onChange={(e) => set({ countries: e.target.value.toUpperCase().split(/[,\s]+/).filter(Boolean) })} />
                </Field>
              </div>
            </Section>

            <Section n="4" title={t(['الإعلان', 'Publicité'])}>
              <Segmented
                value={f.source}
                onChange={(v) => set({ source: v })}
                options={[
                  { value: 'image', label: t(['صورة + نص جديد', 'Image + texte']) },
                  { value: 'fb_post', label: t(['منشور فيسبوك موجود', 'Post Facebook existant']) },
                  { value: 'ig_post', label: t(['منشور إنستغرام موجود', 'Post Instagram existant']) },
                ]}
              />
              {f.source === 'image' && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {[...(ctx.product.images || []).map((i) => i.url), ...(ctx.generated_images || []).map((i) => i.url)].map((url) => (
                      <button key={url} type="button" onClick={() => set({ image_url: url })} className={cx('overflow-hidden rounded-lg border-2', f.image_url === url ? 'border-brand' : 'border-transparent')}>
                        <img src={url} alt="" className="h-20 w-20 object-cover" loading="lazy" />
                      </button>
                    ))}
                    {!ctx.product.images?.length && !ctx.generated_images?.length && (
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <ImageIcon className="h-4 w-4" />
                        {t(['لا صور: ارفع صوراً أو ولّدها من محرر المنتج', 'Aucune image : ajoutez-en dans l’éditeur produit'])}
                      </div>
                    )}
                  </div>
                  <Field label={t(['أو رابط صورة', 'Ou URL d’image'])}>
                    <Input className="ltr" value={f.image_url} onChange={(e) => set({ image_url: e.target.value })} />
                  </Field>
                </div>
              )}
              {f.source !== 'image' && (
                <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                  {!posts && <Loading />}
                  {(f.source === 'fb_post' ? posts?.facebook : posts?.instagram)?.map((p) => {
                    const sel = f.source === 'fb_post' ? f.post_id === p.id : f.ig_media_id === p.id;
                    return (
                      <button key={p.id} type="button" onClick={() => set(f.source === 'fb_post' ? { post_id: p.id } : { ig_media_id: p.id })} className={cx('card overflow-hidden text-start', sel && 'border-brand ring-2 ring-brand/30')}>
                        {p.image && <img src={p.image} alt="" className="h-24 w-full object-cover" loading="lazy" />}
                        <div className="p-2 text-[11px]">
                          <div className="line-clamp-2 text-ink">{p.text || '—'}</div>
                          <div className="mt-1 text-muted">
                            ♥ {p.likes} · 💬 {p.comments}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {posts && !(f.source === 'fb_post' ? posts.facebook : posts.instagram)?.length && <p className="col-span-full text-xs text-muted">{t(['لا منشورات (تحقق من رمز الصفحة في الإعدادات)', 'Aucune publication (vérifiez le jeton de page)'])}</p>}
                </div>
              )}
              {f.source !== 'fb_post' && (
                <div className="mt-3 space-y-3">
                  {ctx.ad_copy?.variants?.length > 0 && f.source === 'image' && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Sparkles className="h-3.5 w-3.5 text-brand" />
                      <span className="text-sub">{t(['نصوص مولّدة:', 'Textes générés :'])}</span>
                      {ctx.ad_copy.variants.slice(0, 8).map((v, k) => (
                        <Button key={k} size="sm" onClick={() => set({ primary_text: v.primary_text, headline: v.headline, description: v.description })}>
                          {v.angle} · {v.language}
                        </Button>
                      ))}
                    </div>
                  )}
                  {f.source === 'image' && (
                    <>
                      <Field label={t(['النص الأساسي', 'Texte principal'])}>
                        <Textarea className="min-h-[110px]" value={f.primary_text} onChange={(e) => set({ primary_text: e.target.value })} />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t(['العنوان', 'Titre'])}>
                          <Input value={f.headline} maxLength={60} onChange={(e) => set({ headline: e.target.value })} />
                        </Field>
                        <Field label={t(['الوصف', 'Description'])}>
                          <Input value={f.description} maxLength={60} onChange={(e) => set({ description: e.target.value })} />
                        </Field>
                      </div>
                    </>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t(['زر الدعوة', 'Bouton'])}>
                      <Select value={f.cta} onChange={(e) => set({ cta: e.target.value })} options={CTAS.map((c) => ({ value: c, label: c }))} />
                    </Field>
                    <Field label={t(['رابط الوجهة', 'Lien de destination'])} hint={!ctx.published ? t(['المنتج غير منشور: انشره من محرر المنتج أو ضع رابط صفحة هبوط / اختبار A/B', 'Produit non publié : publiez-le ou utilisez une landing / test A/B']) : t(['يمكنك وضع رابط اختبار A/B ‎/go/…‎', 'Vous pouvez mettre un lien de test A/B /go/…'])}>
                      <Input className="ltr" list="pinned-urls-launch" value={f.link} onChange={(e) => set({ link: e.target.value })} />
                    </Field>
                  </div>
                  <PageSuggest id="pinned-urls-launch" />
                </div>
              )}
            </Section>

            <Field label={t(['اسم الحملة (اختياري)', 'Nom de la campagne (facultatif)'])}>
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={`${ctx.product.title.slice(0, 40)} · FB+IG · …`} />
            </Field>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div className="card overflow-hidden">
              <div className="border-b border-line px-3 py-2 text-xs font-semibold text-sub">{t(['معاينة تقريبية', 'Aperçu approximatif'])}</div>
              <div className="p-3 text-sm">
                <p className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-5">{f.source === 'image' ? f.primary_text || '…' : t(['المنشور كما هو بتفاعلاته', 'La publication telle quelle'])}</p>
              </div>
              {f.source === 'image' && f.image_url && <img src={f.image_url} alt="" className="aspect-square w-full object-cover" />}
              <div className="flex items-center justify-between gap-2 bg-raised px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] uppercase text-muted">{f.link ? hostOf(f.link) : '—'}</div>
                  <div className="truncate text-sm font-semibold">{f.headline}</div>
                </div>
                <span className="btn btn-sm shrink-0">{f.cta.replace('_', ' ')}</span>
              </div>
            </div>
            {problems.length > 0 ? (
              <ul className="space-y-1 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs">
                {problems.map((p) => (
                  <li key={p} className="flex items-start gap-1.5 text-ink">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg border border-good/40 bg-good/5 p-3 text-xs">
                <CheckCircle2 className="h-4 w-4 text-good" />
                {t(['جاهزة للإنشاء', 'Prête à être créée'])}
              </p>
            )}
            <Button className="w-full" icon={Save} loading={busy === 'draft'} onClick={saveDraft}>
              {t(['حفظ كمسودة في الـ ERP', 'Enregistrer en brouillon'])}
            </Button>
            <Button className="w-full" variant="primary" icon={Rocket} loading={busy === 'launch' && !f.activate} disabled={problems.length > 0} onClick={() => launch(false)}>
              {t(['إنشاء على Meta (متوقفة للمراجعة)', 'Créer sur Meta (en pause)'])}
            </Button>
            <div className="rounded-lg border border-line p-3">
              <Toggle checked={confirmActivate} onChange={setConfirmActivate} label={t(['تفعيل فوري بعد الإنشاء', 'Activer immédiatement'])} />
              {confirmActivate && (
                <div className="mt-2 space-y-2">
                  <p className="flex gap-1.5 text-xs text-warn">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    {t(['سيبدأ الصرف فوراً بميزانية {b} يومياً.', 'La dépense démarre immédiatement : {b} / jour.'], { b: f.daily_budget ? money(Number(f.daily_budget), currency) : '—' })}
                  </p>
                  <Button className="w-full" variant="danger" disabled={problems.length > 0} loading={busy === 'launch'} onClick={() => launch(true)}>
                    {t(['إنشاء وتفعيل الآن', 'Créer et activer'])}
                  </Button>
                </div>
              )}
            </div>
            <p className="text-[11px] leading-5 text-muted">{t(['آخر حساب وصفحة وبيكسل وجمهور تستعملها تُحفظ تلقائياً كإعدادات دائمة لهذا المشروع، والميزانية لا تُخمَّن أبداً.', 'Le dernier compte, page, pixel et audience utilisés sont mémorisés pour ce projet ; le budget n’est jamais deviné.'])}</p>
          </aside>
        </div>
      )}
    </Modal>
  );
}

function Section({ n, title, children }) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[11px] text-brand-ink">{n}</span>
        {title}
      </h4>
      {children}
    </section>
  );
}

/** زر «إطلاق حملة» يُوضع بجانب أي منتج في أي صفحة */
export function LaunchButton({ product, size = 'sm', variant, label, onDone }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={Rocket} onClick={() => setOpen(true)}>
        {label ?? t(['إطلاق حملة', 'Lancer une campagne'])}
      </Button>
      {open && (
        <LaunchCampaign
          productId={product.id}
          projectId={product.project_id}
          open={open}
          onClose={(created) => {
            setOpen(false);
            if (created) onDone?.();
          }}
        />
      )}
    </>
  );
}
