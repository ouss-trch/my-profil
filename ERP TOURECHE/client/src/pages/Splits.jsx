import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Award, Info, Pause, Play, Plus, Split, Square, Trash2, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { ago, da, n0, pct } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Bar, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Toggle, cx, useAction } from '../components/ui.jsx';
import { SERIES } from '../components/charts.jsx';
import PageSuggest from '../components/PageSuggest.jsx';
import AttributionNotice from '../components/AttributionNotice.jsx';
import { TrackingBadge } from '../components/Traffic.jsx';

const STATUS = { draft: ['مسودة', 'Brouillon', 'neutral'], running: ['يعمل', 'En cours', 'good'], paused: ['متوقف', 'En pause', 'warn'], ended: ['منتهٍ', 'Terminé', 'neutral'] };
const GOALS = {
  orders: ['الطلبيات (معدل تحويل الصفحة)', 'Commandes (taux de conversion de la page)'],
  confirmed: ['الطلبيات المؤكدة', 'Commandes confirmées'],
  delivered: ['الطلبيات المسلّمة (تحتاج 14 يوماً على الأقل)', 'Commandes livrées (14 jours minimum)'],
};
const VERDICTS = {
  collecting: ['يجمع البيانات', 'Collecte en cours', 'info'],
  trending: ['يتجه نحو فائز — أكمل الاختبار', 'Tendance — continuez', 'info'],
  winner: ['يوجد فائز واضح', 'Gagnant clair', 'good'],
  no_difference: ['لا فرق حقيقي', 'Pas de vraie différence', 'warn'],
  split_broken: ['توزيع الزوار لا يطابق النسب', 'Répartition faussée', 'bad'],
};
// ما ينتظره الحكم: {have} من {need}
const WAITING = {
  days: ['المدة: {have} من {need} أيام', 'Durée : {have} / {need} jours'],
  orders: ['أقل نسخة: {have} من {need} طلبية', 'Version la plus faible : {have} / {need} commandes'],
  visitors: ['أقل نسخة: {have} من {need} زائر', 'Version la plus faible : {have} / {need} visiteurs'],
};

export default function Splits() {
  const { id } = useParams();
  return id ? <SplitDetail id={id} /> : <SplitList />;
}

function HowItWorks() {
  const { t } = useI18n();
  return (
    <Card>
      <div className="flex gap-3 text-sm leading-7">
        <Info className="mt-1 h-4 w-4 shrink-0 text-brand" />
        <div className="text-sub">
          <b className="text-ink">{t(['كيف يعمل؟', 'Comment ça marche ?'])}</b>{' '}
          {t(
            ['ضع في الإعلان «رابط الاختبار» الذي يعطيك إياه الـ ERP (رابط المنتج ومعه ⁦?erp_t=⁩). كل زائر يأتي منه يُعرض عليه A أو B أو C (صفحة المنتج أو صفحة هبوط) حسب النسبة، ويبقى على نفس النسخة إن عاد. أما صفحة المنتج العادية فتبقى كما هي لكل من يتصفح المتجر من الأقسام، ورابط كل صفحة هبوط يفتحها هي نفسها. عدّاد المتجر يعدّ زوار كل نسخة، وكل طلبية تُنسب للصفحة التي أُرسل منها النموذج، ثم يقارن الـ ERP ويحسب احتمال أن تكون كل صفحة هي الأفضل.', 'Dans la pub, mettez le « lien du test » donné par l’ERP (lien produit + ?erp_t=). Chaque visiteur venu par ce lien voit A, B ou C (page produit ou landing page) selon vos poids, et garde sa version s’il revient. La page produit normale ne change pas pour qui navigue dans la boutique, et le lien de chaque landing page ouvre cette page. Le compteur de la boutique compte les visiteurs de chaque version et chaque commande compte pour la page d’où le formulaire est parti ; l’ERP compare et calcule la probabilité que chaque page soit la meilleure.'],
          )}
          <span className="mt-1 block text-xs">
            {t(['يعمل داخل Shopify 24/7 دون الحاجة لتشغيل جهازك. شرط سياسة Meta: كل النسخ تعرض نفس المنتج ونفس العرض؛ غيّر التصميم والصور والزاوية فقط.', 'Fonctionne dans Shopify 24/7, sans votre ordinateur. Politique Meta : même produit et même offre partout ; changez seulement design, visuels et angle.'])}
          </span>
        </div>
      </div>
    </Card>
  );
}

/** حالة الربط مع Shopify: السنيبت في القالب + مزامنة الإعدادات */
function ShopifyPanel() {
  const { t, lang } = useI18n();
  const { isAll } = useApp();
  const { data, error, loading, reload } = useApi('/splits/shopify/status', { skip: isAll });
  const { run, busy } = useAction();
  const [manual, setManual] = useState(null);
  if (isAll) return null;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.configured)
    return (
      <Card>
        <p className="text-sm text-sub">{t(['اربط Shopify في الإعدادات ← التكاملات لتفعيل الاختبار على نفس دومين المتجر.', 'Connectez Shopify (Paramètres → Intégrations) pour tester sur le domaine de la boutique.'])}</p>
      </Card>
    );
  const install = async () => {
    const r = await run('install', () => api.post('/splits/shopify/install', {}), { success: false });
    if (!r) return;
    if (r.ok) {
      reload(true);
    } else setManual(r);
  };
  return (
    <Card
      title={t(['الربط مع القالب (نفس الدومين)', 'Intégration au thème (même domaine)'])}
      actions={
        <>
          <Button size="sm" loading={busy === 'sync'} onClick={() => run('sync', () => api.post('/splits/shopify/sync', {}), { success: t(['أُرسلت الإعدادات إلى المتجر', 'Réglages envoyés à la boutique']) }).then(() => reload(true))}>
            {t(['مزامنة الآن', 'Synchroniser'])}
          </Button>
          {(!data.installed || data.snippet_outdated) && (
            <Button size="sm" variant="primary" loading={busy === 'install'} onClick={install}>
              {t(['تثبيت على القالب', 'Installer sur le thème'])}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setManual({ snippet: data.snippet, render_line: data.render_line })}>
            {t(['التثبيت اليدوي', 'Installation manuelle'])}
          </Button>
        </>
      }
    >
      <AttributionNotice health={data.attribution} className="mb-3" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {data.theme && <Badge>{data.theme.name}</Badge>}
        {data.installed ? (
          <Badge tone="good">{t(['عدّاد الزوار مثبت في القالب', 'Compteur installé dans le thème'])}</Badge>
        ) : data.paste_broken ? (
          <Badge tone="bad">{t(['خطأ في اللصق: نص زائد يظهر في المتجر', 'Collage erroné : texte parasite visible'])}</Badge>
        ) : data.missing_scopes?.length ? (
          <Badge tone="warn">
            {t(['ينقص تطبيق Shopify الإذن', 'Autorisation Shopify manquante'])} <span className="ltr">{data.missing_scopes.join('\u00a0+\u00a0')}</span>
          </Badge>
        ) : data.theme_error ? (
          <Badge tone="warn" title={data.theme_error}>
            {t(['تعذّر قراءة القالب — استعمل التثبيت اليدوي', 'Thème illisible — installation manuelle'])}
          </Badge>
        ) : (
          <Badge tone="warn">{t(['غير مثبت بعد', 'Pas encore installé'])}</Badge>
        )}
        {data.auto_updated && <Badge tone="info">{t(['حُدّث السنيبت تلقائياً الآن', 'Snippet mis à jour automatiquement'])}</Badge>}
        {data.sync?.at && (data.sync.error ? <Badge tone="bad" title={data.sync.error}>{t(['فشلت آخر مزامنة', 'Dernière synchro en échec'])}</Badge> : <Badge tone="good">{t(['آخر مزامنة', 'Synchro'])} · {data.sync.tests}</Badge>)}
        {data.installed && data.beacon && <TrackingBadge health={data.tracking} />}
        {!data.beacon && <span className="text-xs text-muted">{t(['عدّ الزوار يحتاج الـ ERP على الـ VPS (عنوان عام): الحكم الآن بالطلبيات مقارنة بنِسب التوزيع', 'Le comptage des visiteurs exige l’ERP sur le VPS (adresse publique) : verdict sur les commandes rapportées aux poids'])}</span>}
      </div>
      {data.sync?.skipped?.length > 0 && (
        <p className="mt-3 rounded-lg bg-warn/5 p-3 text-xs leading-6 text-sub">
          {t(
            [
              'لا يُوجَّه أي زائر إلى هذه النسخ لأن صفحتها لم تعد في المتجر (سُحبت، أو تغيّر القالب المنشور): {list}. أعد نشر الصفحة من «صفحات الهبوط»، أو أنهِ الاختبار.',
              'Aucun visiteur n’est envoyé vers ces versions, leur page n’existe plus dans la boutique (retirée, ou thème changé) : {list}. Republiez la page (Landing pages) ou terminez le test.',
            ],
            { list: data.sync.skipped.map((x) => `${x.test} · ${x.label}`).join(lang === 'ar' ? '، ' : ', ') },
          )}
        </p>
      )}
      {data.paste_broken && (
        <p className="mt-3 rounded-lg bg-bad/5 p-3 text-xs leading-6 text-bad">
          {t([
            'في القالب «%}» زائدة من اللصق اليدوي، وتظهر نصاً في أعلى كل صفحة من المتجر. اضغط «تثبيت على القالب» ليصلحها الـ ERP، أو احذفها يدوياً من آخر ملف snippets/erp-split.liquid، ومن هذا السطر في layout/theme.liquid حتى يصبح:',
            'Un « %} » en trop (collage manuel) s’affiche en haut de chaque page. « Installer sur le thème » le corrige ; sinon supprimez-le à la fin de snippets/erp-split.liquid et dans layout/theme.liquid pour obtenir :',
          ])}{' '}
          <code className="ltr inline-block rounded bg-raised px-1.5 text-ink">{data.render_line}</code>
        </p>
      )}
      {data.installed && data.snippet_outdated && (
        <p className="mt-3 text-xs text-muted">{t(['السنيبت في القالب أقدم من نسخة الـ ERP: اضغط «تثبيت على القالب» لتحديثه.', 'Le snippet du thème est plus ancien que celui de l’ERP : réinstallez-le.'])}</p>
      )}
      {!data.installed && !data.paste_broken && !data.missing_scopes?.length && !data.theme_error && (
        <p className="mt-3 text-xs leading-6 text-sub">
          {t([
            'التثبيت مرة واحدة: يضيف سطراً في رأس القالب يعدّ زوار كل صفحة (مخفياً، لا يؤخر المتجر) ويشغّل اختبارات A/B. بعدها يحدّثه الـ ERP وحده بعد كل تحديث.',
            'Installation unique : une ligne en tête du thème compte les visiteurs de chaque page (invisible, sans ralentir) et fait tourner les tests A/B. L’ERP la tient ensuite à jour seul.',
          ])}
        </p>
      )}
      {!data.installed && data.missing_scopes?.length > 0 && (
        <p className="mt-3 rounded-lg bg-warn/10 p-3 text-xs leading-6 text-sub">
          {t([
            'أضِف الإذن في Dev Dashboard ← تطبيقك ← Versions ← Release، ثم وافق عليه في المتجر: افتح التطبيق من «Applications» في لوحة Shopify. الإذن لا يعمل قبل هذه الموافقة. بعدها اضغط «تثبيت على القالب».',
            'Ajoutez l’autorisation dans Dev Dashboard → votre app → Versions → Release, puis approuvez-la dans la boutique : ouvrez l’app depuis « Applications ». Elle ne compte qu’après cette approbation. Ensuite : « Installer sur le thème ».',
          ])}
        </p>
      )}
      <Modal
        open={Boolean(manual)}
        onClose={() => {
          setManual(null);
          reload(true); // بعد اللصق اليدوي: الحالة تصبح «مثبت» دون تحديث الصفحة
        }}
        size="lg"
        title={t(['التثبيت اليدوي (مرة واحدة، دقيقتان)', 'Installation manuelle (une fois, 2 min)'])}
      >
        {manual && (
          <div className="space-y-3 text-sm">
            {manual.error && (
              <ErrorBox
                error={{
                  code: manual.missing_scopes?.length
                    ? `theme_scopes_missing:${manual.missing_scopes.join('\u00a0+\u00a0')}`
                    : /^theme_/.test(manual.error)
                      ? manual.error
                      : `${t(['التثبيت التلقائي غير مسموح من Shopify لهذا الرمز', 'Installation auto refusée par Shopify'])}: ${manual.error}`,
                }}
              />
            )}
            <ol className="list-decimal space-y-2 ps-5 leading-7">
              <li>{t(['Shopify ← المتجر الإلكتروني ← القوالب ← … ← تعديل الكود.', 'Shopify → Boutique en ligne → Thèmes → … → Modifier le code.'])}</li>
              <li>
                {t(['في مجلد Snippets أنشئ ملفاً باسم', 'Dans Snippets, créez le fichier'])} <code className="ltr rounded bg-raised px-1">erp-split.liquid</code> {t(['والصق فيه الكود التالي:', 'et collez :'])}
              </li>
            </ol>
            <div className="flex justify-end">
              <CopyButton text={manual.snippet} />
            </div>
            <pre className="ltr max-h-56 overflow-auto rounded-lg bg-raised p-3 text-[11px] leading-5">{manual.snippet}</pre>
            <ol start={3} className="list-decimal space-y-2 ps-5 leading-7">
              <li>
                {t(['افتح layout/theme.liquid وضع هذا السطر مباشرة بعد الوسم', 'Ouvrez layout/theme.liquid et ajoutez juste après'])} <code className="ltr rounded bg-raised px-1">&lt;head&gt;</code>:
              </li>
            </ol>
            <div className="flex items-center gap-2">
              <code className="ltr flex-1 rounded-lg bg-raised px-3 py-2">{manual.render_line}</code>
              <CopyButton text={manual.render_line} />
            </div>
            <p className="text-xs text-muted">{t(['بعدها كل التغييرات (الصفحات، النسب، التشغيل، الإيقاف) تتم من هنا تلقائياً دون لمس القالب مجدداً.', 'Ensuite tout (pages, poids, démarrage, arrêt) se fait d’ici sans retoucher le thème.'])}</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function SplitList() {
  const { t, lang } = useI18n();
  const { isAll } = useApp();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi('/splits');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Split}
        title={t('nav.splits')}
        subtitle={t(['رابط إعلان واحد يوزّع الزوار على عدة صفحات هبوط لمعرفة أيها يحوّل الزوار إلى طلبيات أكثر', 'Un lien de pub qui répartit les visiteurs entre plusieurs landing pages pour trouver celle qui convertit le mieux'])}
        actions={
          <Button variant="primary" icon={Plus} disabled={isAll} title={isAll ? t('c.selectProject') : undefined} onClick={() => setOpen(true)}>
            {t(['اختبار جديد', 'Nouveau test'])}
          </Button>
        }
      />
      <HowItWorks />
      <ShopifyPanel />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.length ? (
        <Card>
          <Empty icon={Split} title={t(['لا اختبارات بعد', 'Aucun test'])} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Link key={s.id} to={`/splits/${s.id}`} className="card flex flex-col gap-2 p-4 transition hover:border-brand/50">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{s.name}</span>
                <Badge tone={STATUS[s.status][2]}>{t(STATUS[s.status])}</Badge>
              </div>
              <div className="ltr text-xs text-muted">/go/{s.slug}</div>
              {s.product_title && <div className="truncate text-xs text-sub">{s.product_title}</div>}
              <div className="flex flex-wrap gap-1.5">
                {s.variants.map((v, i) => (
                  <span key={v.id} className={cx('chip bg-raised', !v.active && 'opacity-50')}>
                    <span className="h-2 w-2 rounded-full" style={{ background: SERIES[i % 4] }} />
                    {v.label} · {v.weight}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex justify-between pt-1 text-xs text-sub">
                <span>
                  {n0(s.summary.visitors)} {t(['زائر', 'visiteurs'])}
                </span>
                <span>{ago(s.started_at || s.created_at, lang)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <SplitForm
        open={open}
        onClose={(created) => {
          setOpen(false);
          if (created) nav(`/splits/${created.id}`);
        }}
      />
    </div>
  );
}

const CUSTOM = '__custom';
// حصص متساوية مجموعها 100 (3 صفحات: 34 · 33 · 33)
const shares = (n) => Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));

/**
 * الصفحات التي يمكن اختبارها لمنتج: صفحة المنتج الأصلية، صفحات الهبوط المنشورة من الـ ERP (باسم الزاوية)،
 * ثم باقي صفحات المتجر. القيمة دائماً الرابط النهائي (‎?view=lp-…‎) لا التحويلة ‎/pages/…‎
 */
function usePageChoices(open, productId, productInfo) {
  const { t } = useI18n();
  const pages = useApi('/pages', { skip: !open });
  const landings = useApi('/pages/landing', { skip: !open });
  const pid = productId ? Number(productId) : null;
  const base = landings.data?.base || pages.data?.base || '';
  const mine = (x) => !pid || x.product_id === pid;
  const seen = new Set();
  const take = (list) => list.filter((o) => o.value && !seen.has(o.value) && seen.add(o.value));
  const product = take((pages.data?.rows || []).filter((p) => p.kind === 'product' && !p.gone && mine(p) && !/[?&]view=/.test(p.url)).map((p) => ({ value: p.url, label: p.title, path: p.path })));
  // صفحات المتجر لم تُزامن بعد: صفحة المنتج من رابطه في Shopify
  if (productInfo?.handle && base && !product.some((o) => o.path === `/products/${productInfo.handle}`)) {
    const path = `/products/${productInfo.handle}`;
    product.unshift(...take([{ value: `${base}${path}`, label: productInfo.title, path }]));
  }
  const lps = take(
    (landings.data?.rows || [])
      .filter((l) => l.status === 'published' && l.target_url && base && mine(l))
      .map((l) => ({ value: `${base}${l.target_url}`, label: `${l.angle} · /pages/${l.slug}`, name: l.angle })),
  );
  const others = take((pages.data?.rows || []).filter((p) => !p.gone && p.published && (p.kind !== 'product' || /[?&]view=/.test(p.url)) && (p.pinned || mine(p))).map((p) => ({ value: p.url, label: p.title || p.path })));
  // صفحات الهبوط المنشورة لمنتج معيّن (لملء الاختبار تلقائياً)
  const landingsOf = (id) =>
    (landings.data?.rows || []).filter((l) => l.status === 'published' && l.target_url && base && l.product_id === Number(id)).map((l) => ({ url: `${base}${l.target_url}`, name: l.angle }));
  return {
    base,
    product,
    landingsOf,
    groups: [
      { label: t(['صفحة المنتج الأصلية', 'Page produit d’origine']), items: product },
      { label: t(['صفحات الهبوط من الـ ERP (الزاوية)', 'Landing pages de l’ERP (angle)']), items: lps },
      { label: t(['صفحات أخرى في المتجر', 'Autres pages de la boutique']), items: others },
    ],
  };
}

function PagePicker({ value, custom, groups, onPick, onCustom, mode }) {
  const { t } = useI18n();
  const known = groups.some((g) => g.items.some((o) => o.value === value));
  const showInput = custom || (value && !known);
  return (
    <div className="min-w-0 space-y-1.5">
      <select
        aria-label={t(['الصفحة', 'Page'])}
        className="input pe-8"
        value={showInput ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return onCustom();
          const o = groups.flatMap((g) => g.items).find((x) => x.value === e.target.value);
          onPick(e.target.value, o);
        }}
      >
        <option value="">{t(['اختر الصفحة…', 'Choisir la page…'])}</option>
        {groups.map((g) =>
          g.items.length ? (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
        <option value={CUSTOM}>{t(['رابط آخر (أكتبه بنفسي)…', 'Autre lien (saisie libre)…'])}</option>
      </select>
      {showInput && (
        <Input
          aria-label={t(['رابط الصفحة', 'URL de la page'])}
          className="ltr"
          list="pinned-urls"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          placeholder={mode === 'shopify' ? 'https://souqnna.com/products/thermos?view=angle-a' : 'https://souqnna.com/products/…'}
        />
      )}
    </div>
  );
}

function SplitForm({ open, onClose, initial }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products', { skip: !open || Boolean(initial) });
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open)
      setF(
        initial
          ? { name: initial.name, goal: initial.goal, sticky: initial.sticky, entry_path: initial.entry_path || '', mode: initial.mode, variants: initial.variants.map((v) => ({ name: v.name || '', url: v.url, weight: v.weight, active: v.active })) }
          : { name: '', product_id: '', mode: 'shopify', entry_path: '', goal: 'orders', sticky: true, variants: [{ name: '', url: '', weight: 50, active: true }, { name: '', url: '', weight: 50, active: true }] },
      );
  }, [open, initial]);
  const pid = initial ? initial.product_id : f?.product_id;
  const choices = usePageChoices(open, pid, (products.data || []).find((x) => String(x.id) === String(pid)));
  if (!f) return null;
  const setV = (k, patch) => setF({ ...f, variants: f.variants.map((v, j) => (j === k ? { ...v, ...patch } : v)) });
  const total = f.variants.filter((v) => v.active).reduce((s, v) => s + Number(v.weight || 0), 0);
  // اختيار المنتج يبني الاختبار كله: A = صفحة المنتج الرسمية (رابط المنشورات والإعلانات)،
  // ثم كل صفحات الهبوط المنشورة لهذا المنتج — 3 صفحات هبوط + صفحة المنتج = 4 نسخ بحصص متساوية
  const pickProduct = (id) => {
    const p = (products.data || []).find((x) => String(x.id) === String(id));
    const path = p?.handle ? `/products/${p.handle}` : '';
    const origin = path && choices.base ? `${choices.base}${path}` : '';
    if (!origin) return setF({ ...f, product_id: id });
    const pages = [{ url: origin, name: t(['صفحة المنتج', 'Page produit']) }, ...choices.landingsOf(id)].slice(0, 6);
    if (pages.length < 2) pages.push({ url: '', name: '' });
    const w = shares(pages.length);
    setF({
      ...f,
      product_id: id,
      name: f.name || p.handle,
      entry_path: path,
      variants: pages.map((x, k) => ({ ...x, weight: w[k], active: true })),
    });
  };
  // تعديل اختبار: صفحات هبوط نُشرت بعد إنشائه
  const missing = initial && initial.product_id ? choices.landingsOf(initial.product_id).filter((x) => !f.variants.some((v) => v.url === x.url)) : [];
  const lpCount = !initial && f.product_id ? choices.landingsOf(f.product_id).length : null;
  const save = async () => {
    const body = { ...f, product_id: f.product_id ? Number(f.product_id) : undefined, variants: f.variants.map(({ custom, ...v }) => ({ ...v, weight: Number(v.weight) })) };
    const r = await run('save', () => (initial ? api.patch(`/splits/${initial.id}`, body) : api.post('/splits', body)));
    if (r) onClose(r);
  };
  return (
    <Modal
      open={open}
      onClose={() => onClose(null)}
      size="lg"
      title={initial ? t(['تعديل الاختبار', 'Modifier le test']) : t(['اختبار صفحات جديد', 'Nouveau test de pages'])}
      icon={Split}
      footer={
        <Button variant="primary" loading={busy === 'save'} disabled={!f.name.trim() || f.variants.filter((v) => v.url).length < 2} onClick={save}>
          {t('c.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t(['اسم الاختبار (يصبح الرابط)', 'Nom du test (devient le lien)'])}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="thermos" />
          </Field>
          {!initial && (
            <Field label={t('c.product')}>
              <Select value={f.product_id} onChange={(e) => pickProduct(e.target.value)} placeholder={t('c.optional')} options={(products.data || []).map((p) => ({ value: p.id, label: p.title }))} />
            </Field>
          )}
          {!initial && (
            <Field label={t(['أين يتم التبديل؟', 'Où se fait la rotation ?'])} className="sm:col-span-2">
              <Select
                value={f.mode}
                onChange={(e) => setF({ ...f, mode: e.target.value })}
                options={[
                  { value: 'shopify', label: t(['داخل متجرك على نفس الدومين (موصى به، يعمل 24/7)', 'Dans votre boutique, même domaine (recommandé, 24/7)']) },
                  { value: 'redirect', label: t(['رابط ‎/go/…‎ من الـ ERP (يتطلب أن يكون الـ ERP متاحاً من الإنترنت)', 'Lien /go/… de l’ERP (ERP accessible depuis Internet)']) },
                ]}
              />
            </Field>
          )}
          {f.mode === 'shopify' && (
            <Field
              label={t(['صفحة المنتج (أساس رابط الاختبار)', 'Page produit (base du lien du test)'])}
              className="sm:col-span-2"
              hint={t(['رابط الإعلان يصبح: هذه الصفحة + ‎?erp_t=اسم-الاختبار. صفحة المنتج نفسها لا تتغيّر لزوار المتجر.', 'Lien de pub : cette page + ?erp_t=nom-du-test. La page produit elle-même ne change pas pour les visiteurs de la boutique.'])}
            >
              <Input className="ltr" list="pinned-paths" value={f.entry_path} onChange={(e) => setF({ ...f, entry_path: e.target.value })} placeholder="/products/thermos" />
            </Field>
          )}
          <Field label={t(['الحكم على أساس', 'Juger sur'])}>
            <Select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} options={Object.entries(GOALS).map(([k, v]) => ({ value: k, label: t(v) }))} />
          </Field>
          <div className="flex items-end pb-2">
            <Toggle checked={f.sticky} onChange={(v) => setF({ ...f, sticky: v })} label={t(['الزائر العائد يرى نفس الصفحة', 'Le visiteur revoit la même page'])} />
          </div>
        </div>
        <div className="space-y-2">
          <div className="label">{t(['الصفحات (2 إلى 6)', 'Pages (2 à 6)'])}</div>
          {f.mode === 'shopify' && (
            <p className="text-xs leading-5 text-muted">
              {t([
                'عند اختيار المنتج تُدرج تلقائياً صفحة المنتج الرسمية (A، رابط منشوراتك وإعلاناتك) وكل صفحات الهبوط المنشورة له من «صفحات الهبوط»، بحصص متساوية: 3 صفحات هبوط + صفحة المنتج = 4 صفحات. يمكنك تعطيل صفحة أو تغييرها من القائمة.',
                'En choisissant le produit, la page produit officielle (A, celle de vos posts et pubs) et toutes ses landing pages publiées sont ajoutées, à parts égales : 3 landing pages + la page produit = 4 pages. Vous pouvez en désactiver ou en changer une.',
              ])}
            </p>
          )}
          {lpCount === 0 && (
            <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs leading-6 text-sub">
              {t([
                'لا صفحات هبوط منشورة لهذا المنتج بعد. أنشئها وانشرها من «صفحات المتجر ← صفحات الهبوط»، أو اختر الصفحة B يدوياً.',
                'Aucune landing page publiée pour ce produit. Créez-la et publiez-la depuis « Pages de la boutique », ou choisissez la page B à la main.',
              ])}
            </p>
          )}
          {lpCount > 5 && <p className="text-xs text-muted">{t(['الحد 6 صفحات: أُدرجت صفحة المنتج وأول 5 صفحات هبوط.', 'Maximum 6 pages : la page produit et les 5 premières landing pages.'])}</p>}
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-info/10 px-3 py-2 text-xs leading-6 text-sub">
              <span className="min-w-0 flex-1">
                {t(['صفحات هبوط منشورة لهذا المنتج ليست في الاختبار:', 'Landing pages publiées absentes du test :'])} <b className="text-ink">{missing.map((x) => x.name).join('، ')}</b>.{' '}
                {t(['إضافتها أثناء التشغيل تبدأ عدّها من الآن.', 'Ajoutées en cours de test, elles comptent à partir de maintenant.'])}
              </span>
              <Button
                size="sm"
                icon={Plus}
                disabled={f.variants.length >= 6}
                onClick={() => {
                  const w = Number(f.variants.find((v) => v.active)?.weight) || 50;
                  setF({ ...f, variants: [...f.variants, ...missing.map((x) => ({ ...x, weight: w, active: true }))].slice(0, 6) });
                }}
              >
                {t(['أضفها', 'Les ajouter'])}
              </Button>
            </div>
          )}
          <p className="rounded-lg bg-raised px-3 py-2 text-xs leading-6 text-sub">
            <b className="text-ink">{t(['نسبة الزوار:', 'Part des visiteurs :'])}</b>{' '}
            {t([
              'من كل 100 زائر يفتح رابط الإعلان، كم يُرسل إلى هذه الصفحة. 50 و50 = نصف الزوار لكل صفحة. اتركها متساوية طوال الاختبار، فتغييرها في المنتصف يفسد المقارنة.',
              'Sur 100 visiteurs du lien de pub, combien vont sur cette page. 50/50 = moitié chacune. Gardez-les égales pendant tout le test.',
            ])}
          </p>
          <PageSuggest id="pinned-paths" field="path" />
          <PageSuggest id="pinned-urls" />
          {f.variants.map((v, k) => (
            <div key={k} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[2rem_1fr_2fr_7.5rem_auto] sm:items-start">
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white sm:mt-1.5" style={{ background: SERIES[k % 4] }}>
                {'ABCDEF'[k]}
              </span>
              <Input value={v.name} onChange={(e) => setV(k, { name: e.target.value })} placeholder={t(['اسم (اختياري)', 'Nom (facultatif)'])} />
              <PagePicker
                value={v.url}
                custom={v.custom}
                groups={choices.groups}
                mode={f.mode}
                onCustom={() => setV(k, { custom: true, url: '' })}
                onPick={(url, o) => setV(k, { url, custom: o ? false : v.custom, name: v.name || o?.name || '' })}
              />
              <label className="flex items-center gap-1.5">
                <span className="text-xs text-muted">{t(['النسبة', 'Part'])}</span>
                <Input aria-label={t(['نسبة الزوار', 'Part des visiteurs'])} className="w-16" type="number" min="0" max="100" value={v.weight} onChange={(e) => setV(k, { weight: e.target.value })} />
                <span className="num text-xs text-muted">{total && v.active ? `${Math.round((100 * Number(v.weight || 0)) / total)}%` : ''}</span>
              </label>
              <div className="flex items-center gap-1">
                <Toggle checked={v.active} onChange={(a) => setV(k, { active: a })} />
                {f.variants.length > 2 && !initial && <Button aria-label={t(['إزالة النسخة', 'Retirer la variante'])} size="sm" variant="ghost" icon={XCircle} onClick={() => setF({ ...f, variants: f.variants.filter((_, j) => j !== k) })} />}
              </div>
            </div>
          ))}
          {f.variants.length < 6 && (
            <Button size="sm" icon={Plus} onClick={() => setF({ ...f, variants: [...f.variants, { name: '', url: '', weight: 50, active: true }] })}>
              {t(['صفحة أخرى', 'Autre page'])}
            </Button>
          )}
          {initial && <p className="text-xs text-muted">{t(['الحروف ثابتة حتى لا تختلط النتائج؛ يمكنك تغيير الرابط أو الوزن أو التعطيل.', 'Les lettres sont fixes pour ne pas mélanger les résultats.'])}</p>}
        </div>
      </div>
    </Modal>
  );
}

function SplitDetail({ id }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(`/splits/${id}`, { interval: 60e3 });
  const { run, busy } = useAction();
  const [edit, setEdit] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data.test;
  const localUrl = `${window.location.origin}/go/${s.slug}`;
  const patch = async (body, key, msg) => {
    const r = await run(key, () => api.patch(`/splits/${s.id}`, body), { success: msg });
    if (r) reload(true);
  };
  const maxRate = Math.max(0.0001, ...data.variants.map((v) => v.goal_rate || 0));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => nav('/splits')}>
          <ArrowRight className="h-4 w-4 ltr:rotate-180" />
          {t('c.back')}
        </Button>
        <h1 className="flex-1 truncate text-lg font-semibold">{s.name}</h1>
        <Badge tone={STATUS[s.status][2]}>{t(STATUS[s.status])}</Badge>
        {s.status !== 'running' && s.status !== 'ended' && (
          <Button variant="primary" icon={Play} loading={busy === 'run'} onClick={() => patch({ status: 'running' }, 'run', t(['بدأ الاختبار', 'Test démarré']))}>
            {t(['تشغيل', 'Démarrer'])}
          </Button>
        )}
        {s.status === 'running' && (
          <Button icon={Pause} loading={busy === 'pause'} onClick={() => patch({ status: 'paused' }, 'pause', t(['أُوقف', 'En pause']))}>
            {t(['إيقاف مؤقت', 'Pause'])}
          </Button>
        )}
        <Button onClick={() => setEdit(true)}>{t('c.edit')}</Button>
        {s.status !== 'ended' && (
          <Button icon={Square} loading={busy === 'end'} onClick={() => patch({ status: 'ended' }, 'end', t(['انتهى الاختبار', 'Test terminé']))}>
            {t(['إنهاء', 'Terminer'])}
          </Button>
        )}
        <Button aria-label={t('c.delete')} variant="ghost" icon={Trash2} onClick={() => run('del', () => api.del(`/splits/${s.id}`), { success: t(['حُذف', 'Supprimé']) }).then((r) => r && nav('/splits'))} />
      </div>

      <Card
        title={t(['رابط الاختبار (ضعه في الإعلان)', 'Lien du test (à mettre dans la pub)'])}
        subtitle={s.mode === 'shopify' ? t(['صفحة المنتج دون ⁦?erp_t=⁩ تبقى كما هي لزوار المتجر.', 'Sans ?erp_t=, la page produit reste normale pour la boutique.']) : undefined}
      >
        {s.mode === 'shopify' && !s.public_url ? (
          <p className="text-sm text-warn">{t(['حدد دومين المتجر في الإعدادات ← تكاملات المشروع ← «دومين المتجر».', 'Renseignez le domaine de la boutique dans Paramètres → Intégrations.'])}</p>
        ) : s.public_url ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="ltr flex-1 rounded-lg bg-raised px-3 py-2 text-sm">{s.public_url}</code>
            <CopyButton text={s.public_url} size="md" />
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="ltr flex-1 rounded-lg bg-raised px-3 py-2 text-sm">{localUrl}</code>
              <CopyButton text={localUrl} size="md" />
            </div>
            <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs leading-6">
              <Info className="mt-1 h-3.5 w-3.5 shrink-0 text-warn" />
              {t(
                ['هذا الرابط يعمل من شبكتك فقط. ليصل إليه زوار الإعلانات يجب أن يكون الـ ERP متاحاً من الإنترنت 24/7 (Tailscale Funnel أو Cloudflare Tunnel على نطاق فرعي مثل go.souqnna.com)، ثم ضع العنوان العام في الإعدادات ← المشروع ← «الرابط العام لاختبارات الصفحات».', 'Ce lien ne marche que sur votre réseau. Pour les visiteurs des pubs, l’ERP doit être accessible depuis Internet 24/7 (Tailscale Funnel ou Cloudflare Tunnel sur un sous-domaine comme go.souqnna.com), puis renseignez l’URL publique dans Paramètres → Projet.'],
              )}
            </p>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          {t(['الحكم على أساس:', 'Critère :'])} <b>{t(GOALS[data.goal])}</b> · {s.sticky ? t(['الزائر العائد يرى نفس الصفحة', 'Visiteur fidèle à sa page']) : t(['توزيع عشوائي في كل زيارة', 'Aléatoire à chaque visite'])}
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={VERDICTS[data.verdict][2]} className="px-3 py-1 text-sm">
          {t(VERDICTS[data.verdict])}
        </Badge>
        {data.leader && data.leader.p_best !== null && (
          <span className="text-sm text-sub">
            {t(['المتصدر:', 'En tête :'])} <b className="text-ink">{data.leader.label}</b> · {t(['احتمال أن يكون الأفضل', 'probabilité d’être le meilleur'])} <b className="text-ink">{data.leader.p_best}%</b>
          </span>
        )}
        {data.estimation === 'weights' && (
          <Badge tone="info" title={t(['التوزيع عشوائي بأوزان معروفة، فعدد زوار كل صفحة ≈ نسبة وزنها؛ المقارنة تتم بالطلبيات لكل وحدة وزن.', 'Répartition aléatoire à poids connus : on compare les commandes par unité de poids.'])}>
            {t(['التقدير بنسب التوزيع', 'Estimation par les poids'])}
          </Badge>
        )}
      </div>
      {data.waiting?.length > 0 && data.verdict !== 'split_broken' && (
        <p className="text-xs leading-6 text-muted">
          {t(['لا حكم قبل:', 'Pas de verdict avant :'])}{' '}
          {data.waiting.map((w) => t(WAITING[w.key], { have: n0(w.have), need: n0(w.need) })).join(' · ')}
        </p>
      )}
      {data.verdict === 'split_broken' && (
        <p className="rounded-lg bg-bad/5 p-3 text-xs leading-6 text-bad">
          {t(['عدد الزوار في كل نسخة يبتعد عن النسب أكثر مما تفسّره الصدفة، فأي حكم الآن قد يكون خاطئاً. هل يشير إعلان ما مباشرة إلى رابط نسخة بعينها؟ أو غُيّرت النسب أثناء الاختبار؟', 'Les visiteurs par version s’écartent des poids au-delà du hasard : un verdict serait trompeur. Une pub pointe-t-elle sur une version précise ? Les poids ont-ils changé ?'])}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data.variants.map((v, i) => {
          const isLeader = data.leader?.id === v.id;
          const isWinner = s.winner_variant_id === v.id;
          return (
            <Card key={v.id} className={cx(isLeader && data.verdict === 'winner' && 'border-good ring-2 ring-good/30')}>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: SERIES[i % 4] }}>
                  {v.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{v.name || `${t(['الصفحة', 'Page'])} ${v.label}`}</div>
                  <a href={v.url} target="_blank" rel="noreferrer" className="ltr block truncate text-xs text-muted hover:text-ink">
                    {v.url}
                  </a>
                </div>
                {isWinner && <Badge tone="good" icon={Award}>{t(['الفائز', 'Gagnant'])}</Badge>}
                {!v.active && <Badge>{t(['معطّلة', 'Inactive'])}</Badge>}
              </div>
              {v.page && (
                <div className="mb-3 rounded-lg border border-line p-2">
                  <div className="mb-1.5 text-[11px] font-medium text-sub">{t(['الصفحة كلها منذ بداية الاختبار (كل الزوار)', 'Toute la page depuis le début (tous les visiteurs)'])}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <M label={t(['زوار', 'Visiteurs'])} value={n0(v.page.all.visitors)} />
                    <M label={t('c.orders')} value={n0(v.page.all.orders)} />
                    <M label={t(['تحويل', 'Conversion'])} value={pct(v.page.all.conversion, 2)} />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted">
                    {t(['منها خارج رابط الاختبار (رابطها المباشر، المتجر، إعلانات أخرى):', 'Dont hors lien du test (lien direct, boutique, autres pubs) :'])} <span className="num">{n0(v.page.direct.visitors)}</span> {t(['زائر', 'visiteurs'])} · <span className="num">{n0(v.page.direct.orders)}</span> {t(['طلبية', 'commandes'])}
                  </p>
                </div>
              )}
              <div className="mb-1.5 text-[11px] font-medium text-sub">{t(['من رابط الاختبار (يدخل الحكم)', 'Via le lien du test (compte pour le verdict)'])}</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <M label={t(['زوار', 'Visiteurs'])} value={n0(v.visitors)} />
                <M label={t('c.orders')} value={n0(v.orders)} />
                <M label={t(['تحويل', 'Conversion'])} value={pct(v.conversion, 2)} />
                <M label={t(['مؤكدة', 'Confirmées'])} value={n0(v.confirmed)} hint={pct(v.confirm_rate)} />
                <M label={t(['مسلّمة', 'Livrées'])} value={n0(v.delivered)} hint={pct(v.delivery_rate)} />
                <M label={t(['إيراد', 'CA'])} value={da(v.revenue)} />
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-sub">{t(['معدل الهدف لكل زائر', 'Taux objectif / visiteur'])}</span>
                  <span className="num font-semibold">{pct(v.goal_rate, 2)}</span>
                </div>
                <Bar value={(100 * (v.goal_rate || 0)) / maxRate} tone={isLeader ? 'good' : 'brand'} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-sub">
                  {t(['احتمال أن تكون الأفضل', 'Probabilité d’être la meilleure'])}: <b className="text-ink">{v.p_best === null || v.p_best === undefined ? '—' : `${v.p_best}%`}</b>
                </span>
                <span className="text-muted">
                  {t(['الوزن', 'Poids'])} {v.weight} · {t(['من الإعلان', 'depuis pub'])} {n0(v.from_ad)}
                  {s.mode !== 'shopify' && ` · bots ${n0(v.bots)}`}
                </span>
              </div>
              {data.verdict === 'winner' && isLeader && s.status !== 'ended' && (
                <Button className="mt-3 w-full" variant="primary" icon={Award} loading={busy === 'win'} onClick={() => patch({ winner_variant_id: v.id, status: 'ended' }, 'win', t(['اعتُمدت الصفحة الفائزة — الرابط يوجّه الآن إليها فقط', 'Gagnante validée — le lien y redirige désormais']))}>
                  {t(['اعتماد الفائز وإنهاء الاختبار', 'Valider la gagnante et terminer'])}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      <p className="text-xs leading-6 text-muted">
        {t([
          'كل طلبية تُنسب للصفحة التي أُرسل منها النموذج، وتُحسب لنسخة الاختبار فقط إن كان رابط تلك الصفحة يحمل ',
          'Chaque commande est attribuée à la page d’où le formulaire est parti, et à une version du test seulement si l’adresse de cette page porte ',
        ])}
        <span className="ltr">erp_v={s.slug}.A/B/C</span>
        {t([
          ' (يضيفه رابط الاختبار). الزواحف (روبوتات Meta…) لا تُحتسب. من يفتح رابط صفحة هبوط بعينها يبقى عليها، وتُعدّ زيارته وطلبيته لتلك الصفحة خارج الحكم.',
          ' (ajouté par le lien du test). Les robots ne comptent pas. Qui ouvre le lien d’une landing page précise y reste ; sa visite et sa commande comptent pour cette page, hors verdict.',
        ])}
      </p>
      <SplitForm open={edit} initial={edit ? s : null} onClose={(r) => (setEdit(false), r && reload(true))} />
    </div>
  );
}

const M =({ label, value, hint }) => (
  <div className="rounded-lg bg-raised px-2 py-1.5">
    <div className="num text-sm font-semibold">{value}</div>
    <div className="text-[11px] text-muted">
      {label}
      {hint && hint !== '—' ? ` · ${hint}` : ''}
    </div>
  </div>
);
