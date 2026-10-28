import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, KeyRound, Plug, Plus, Save, Server, Settings as SettingsIcon, ShieldCheck, Trash2, Users, FolderKanban, CheckCircle2, XCircle, Download, RefreshCw, Loader2, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { ago, dateTime } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Select, Tabs, Toggle, cx, useAction } from '../components/ui.jsx';

// ——— تعريف الحقول ———
const PROJECT_GROUPS = [
  {
    key: 'store',
    title: ['المتجر', 'Boutique'],
    fields: [
      { k: 'brand_name', label: ['اسم العلامة', 'Nom de marque'] },
      { k: 'store_domain', label: ['دومين المتجر', 'Domaine'], ltr: true, hint: ['مثال: souqnna.com — يُستعمل في روابط المنتجات والإعلانات', 'Ex. souqnna.com — utilisé pour les liens'] },
      { k: 'low_stock_default', label: ['حد تنبيه المخزون الافتراضي', 'Seuil de stock par défaut'], type: 'number' },
      {
        k: 'split_base_url',
        label: ['عنوان الـ ERP العام (لعدّ زوار الاختبارات)', 'Adresse publique de l’ERP (visiteurs des tests)'],
        ltr: true,
        auto: true,
        hint: (v, t) =>
          v._auto?.split_base_url
            ? t(['اتركه فارغاً: يُستعمل عنوان الـ ERP تلقائياً (\u2066{auto}\u2069). غيّره فقط إن نقلت الـ ERP إلى عنوان آخر.', 'Laissez vide : l’adresse de l’ERP est utilisée automatiquement ({auto}). À changer seulement si l’ERP déménage.'], { auto: v._auto.split_base_url })
            : t(['الـ ERP غير منشور على الإنترنت: ضع هنا عنوانه العام (مثلاً https://erp.example.com) حتى تُعدّ زيارات الاختبار.', 'L’ERP n’est pas publié sur Internet : indiquez son adresse publique (ex. https://erp.example.com) pour compter les visites des tests.']),
      },
    ],
  },
  {
    key: 'shopify',
    title: ['Shopify', 'Shopify'],
    test: 'shopify',
    fields: [
      { k: 'shopify_shop', label: ['نطاق myshopify', 'Domaine myshopify'], ltr: true, hint: ['مثل xxxx.myshopify.com — من Shopify ← الإعدادات ← النطاقات (وليس دومين المتجر)', 'Ex. xxxx.myshopify.com — Shopify → Paramètres → Domaines (pas le domaine public)'] },
      { k: 'shopify_client_id', label: ['Client ID (تطبيق Dev Dashboard)', 'Client ID (app Dev Dashboard)'], ltr: true },
      { k: 'shopify_client_secret', label: ['Client secret (shpss_…)', 'Client secret (shpss_…)'], hint: ['يُشفَّر هنا ولا يُعرض. الـ ERP يجدد رمز الدخول كل 24 ساعة تلقائياً', 'Chiffré ici, jamais réaffiché. L’ERP renouvelle le jeton toutes les 24 h'] },
      { k: 'shopify_access_token', label: ['أو Admin API token (shpat_…) لتطبيق قديم', 'Ou token Admin API (shpat_…) d’une ancienne app'] },
      { k: 'shopify_api_version', label: ['إصدار API', 'Version API'], ltr: true },
      { k: 'shopify_sync_orders', label: ['استيراد الطلبيات من Shopify', 'Importer les commandes Shopify'], type: 'bool' },
      { k: 'shopify_tag_orders', label: ['وسم الطلبيات في Shopify بحالة الـ ERP', 'Taguer les commandes Shopify'], type: 'bool' },
    ],
  },
  {
    key: 'meta',
    title: ['Meta (إعلانات، بيكسل، صفحة)', 'Meta (pubs, pixel, page)'],
    test: 'meta',
    fields: [
      {
        k: 'meta_access_token',
        label: ['رمز System User (لا ينتهي)', 'Jeton System User (permanent)'],
        hint: [
          'Business Manager ← الإعدادات ← مستخدمو النظام ← إنشاء رمز، بصلاحيات ads_read وbusiness_management (وads_management لإطلاق الحملات، وpages_show_list وpages_read_engagement للصفحة). احفظه، ثم اضغط «اكتشاف من Meta» لملء الباقي.',
          'Business Manager → Paramètres → Utilisateurs système → Générer un jeton (ads_read, business_management ; ads_management pour lancer ; pages_show_list, pages_read_engagement pour la page). Enregistrez, puis « Détecter depuis Meta ».',
        ],
      },
      { k: 'meta_ad_account_ids', label: ['الحسابات الإعلانية للمشروع (افصل بفاصلة)', 'Comptes pub du projet (virgules)'], type: 'list', ltr: true, hint: ['تُملأ بـ «اكتشاف من Meta»، أو من صفحة الإعلانات ← Business Manager', 'Rempli par « Détecter depuis Meta », ou Pubs → Business Manager'] },
      { k: 'meta_page_id', label: ['معرّف الصفحة', 'ID de la page'], ltr: true },
      { k: 'meta_page_token', label: ['رمز الصفحة (للنشر ومنشوراتها)', 'Jeton de page (publication)'] },
      { k: 'meta_ig_user_id', label: ['معرّف حساب إنستغرام', 'ID Instagram'], ltr: true },
      { k: 'meta_pixel_id', label: ['معرّف البيكسل', 'ID du pixel'], ltr: true, hint: ['نفس بيكسل المتجر: المتجر وn8n يرسلان «Purchase» عند كل طلبية، والـ ERP يرسل «أُكّدت» و«سُلّمت» إن فعّلتهما أدناه', 'Le même pixel que la boutique : boutique et n8n envoient « Purchase », l’ERP envoie « confirmée » et « livrée » si activés'] },
      { k: 'meta_capi_confirmed', label: ['إرسال «طلبية أُكّدت» إلى Meta (CAPI)', 'Envoyer « commande confirmée » à Meta (CAPI)'], type: 'bool', hint: ['عند التأكيد بالهاتف، مربوطة بطلبية المتجر نفسها: Meta تعرف أي إعلان يجلب طلبيات حقيقية، في نفس اليوم', 'À la confirmation téléphonique, liée à la commande d’origine : Meta voit quelle annonce amène de vraies commandes, le jour même'] },
      { k: 'meta_capi_confirmed_event', label: ['اسم حدث التأكيد', "Nom de l'événement de confirmation"], ltr: true },
      { k: 'meta_capi_delivered', label: ['إرسال «طلبية سُلّمت» إلى Meta (CAPI)', 'Envoyer « commande livrée » à Meta (CAPI)'], type: 'bool', hint: ['يعلّم الخوارزمية من يستلم فعلاً لا من يطلب فقط', 'Apprend à l’algorithme qui reçoit vraiment'] },
      { k: 'meta_capi_event', label: ['اسم حدث التسليم', "Nom de l'événement de livraison"], ltr: true },
      {
        k: 'meta_test_event_code',
        label: ['رمز «اختبار الأحداث» (للتجربة فقط)', 'Code « Tester les événements » (essai seulement)'],
        ltr: true,
        hint: (vals, t) =>
          vals.meta_test_event_code
            ? t(['⚠ وضع التجربة مفعّل: أحداث الـ ERP تذهب إلى «اختبار الأحداث» فقط ولا تُستعمل في الإعلانات. امسح الرمز بعد التجربة.', '⚠ Mode test actif : les événements de l’ERP vont seulement dans « Tester les événements ». Videz le code après l’essai.'])
            : t(['من Events Manager ← البيكسل ← «اختبار الأحداث». ضعه واحفظ ثم اضغط «اختبار»: يُرسل حدث تجريبي يتأكد أن الرمز يصل إلى البيكسل. امسحه بعدها.', 'Events Manager → pixel → « Tester les événements ». Enregistrez puis « Tester » : un événement d’essai vérifie l’envoi au pixel. Videz-le ensuite.']),
      },
      { k: 'meta_graph_version', label: ['إصدار Graph API', 'Version Graph API'], ltr: true },
    ],
  },
  {
    key: 'carriers',
    title: ['شركات التوصيل', 'Transporteurs'],
    tests: ['yalidine', 'zr', 'noest'],
    fields: [
      { k: 'default_carrier', label: ['الشركة الافتراضية', 'Transporteur par défaut'], type: 'enum', values: ['', 'yalidine', 'zr', 'noest'] },
      { k: 'yalidine_api_id', label: ['Yalidine API ID', 'Yalidine API ID'], ltr: true },
      { k: 'yalidine_api_token', label: ['Yalidine API token', 'Yalidine API token'] },
      { k: 'yalidine_from_wilaya', label: ['ولاية الانطلاق (Yalidine)', 'Wilaya de départ (Yalidine)'], type: 'number' },
      { k: 'zr_token', label: ['ZR Express token', 'ZR Express token'] },
      { k: 'zr_key', label: ['ZR Express key', 'ZR Express key'] },
      { k: 'noest_api_token', label: ['NOEST api_token', 'NOEST api_token'] },
      { k: 'noest_user_guid', label: ['NOEST user_guid', 'NOEST user_guid'] },
    ],
  },
  {
    key: 'sheet',
    title: ['جدول Google (طلبيات COD)', 'Google Sheet (commandes COD)'],
    test: 'sheets',
    fields: [
      { k: 'sheet_sync', label: ['مزامنة الجدول', 'Synchroniser la feuille'], type: 'bool' },
      { k: 'sheet_id', label: ['معرّف الجدول', 'ID de la feuille'], ltr: true },
      { k: 'sheet_tab', label: ['اسم الورقة', "Nom de l'onglet"], ltr: true },
    ],
  },
  {
    key: 'tests',
    title: ['قواعد اختبار المنتجات', 'Règles des tests produits'],
    fields: [
      { k: 'test_kill_spend_da', label: ['أوقف الاختبار إن صُرف (دج) دون أي تسليم', 'Arrêter si dépensé (DA) sans livraison'], type: 'number' },
      { k: 'test_target_cpd_da', label: ['تكلفة المسلّمة المستهدفة (دج)', 'Coût/livrée cible (DA)'], type: 'number' },
    ],
  },
];

const GLOBAL_GROUPS = [
  {
    key: 'sync',
    title: ['المزامنة', 'Synchronisation'],
    fields: [
      {
        k: 'auto_sync',
        label: ['مزامنة تلقائية في الخلفية (Shopify كل 5 دقائق، التتبع وMeta كل 30 دقيقة)', 'Synchro automatique en arrière-plan (Shopify 5 min, suivi et Meta 30 min)'],
        type: 'bool',
        hint: ['متوقفة: تتم المزامنة الكاملة بزر المزامنة في الشريط العلوي. النسخ الاحتياطي وإرسال المرتجعات إلى Shopify يبقيان تلقائيين.', 'Désactivée : synchro complète avec le bouton de la barre du haut. Sauvegardes et retours vers Shopify restent automatiques.'],
      },
    ],
  },
  {
    key: 'ai',
    title: ['الذكاء الاصطناعي (Claude)', 'Intelligence artificielle (Claude)'],
    test: 'ai',
    fields: [
      { k: 'anthropic_api_key', label: ['مفتاح Claude API', 'Clé API Claude'] },
      {
        k: 'ai_model',
        label: ['النموذج', 'Modèle'],
        type: 'enum',
        values: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
        labels: {
          'claude-opus-5-5': ['Opus 5.5 — الافتراضي، متوازن', 'Opus 5.5 — par défaut, équilibré'],
          'claude-sonnet-5-5': ['Sonnet 5.5 — أرخص بمرتين، جيد جداً', 'Sonnet 5.5 — 2× moins cher, très bon'],
          'claude-haiku-5-5': ['Haiku 5.5 — الأرخص والأسرع', 'Haiku 5.5 — le moins cher, rapide'],
          'claude-fable-5-1': ['Fable 5.1 — الأقوى والأغلى', 'Fable 5.1 — le plus puissant, le plus cher'],
        },
      },
      { k: 'ai_effort', label: ['مستوى التفكير', "Niveau d'effort"], type: 'enum', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ],
  },
  {
    key: 'images',
    title: ['توليد الصور', "Génération d'images"],
    fields: [
      { k: 'image_provider', label: ['المزوّد', 'Fournisseur'], type: 'enum', values: ['none', 'n8n', 'openai', 'gemini'] },
      { k: 'n8n_image_url', label: ['Webhook n8n للصور', 'Webhook n8n images'], ltr: true },
      { k: 'openai_api_key', label: ['مفتاح OpenAI', 'Clé OpenAI'] },
      { k: 'openai_image_model', label: ['نموذج OpenAI', 'Modèle OpenAI'], ltr: true },
      { k: 'gemini_api_key', label: ['مفتاح Gemini', 'Clé Gemini'] },
      { k: 'gemini_image_model', label: ['نموذج Gemini', 'Modèle Gemini'], ltr: true },
    ],
  },
  {
    key: 'fx',
    title: ['أسعار الصرف (السوق الموازي)', 'Taux de change (marché parallèle)'],
    fields: [
      { k: 'fx_usd_dza', label: ['1 دولار = ؟ دج', '1 USD = ? DA'], type: 'number' },
      { k: 'fx_eur_dza', label: ['1 يورو = ؟ دج', '1 EUR = ? DA'], type: 'number' },
    ],
  },
  {
    key: 'n8n',
    title: ['n8n (leadsauto.cloud)', 'n8n (leadsauto.cloud)'],
    tests: ['events', 'products', 'report'],
    fields: [
      { k: 'n8n_events_url', label: ['Webhook الأحداث (الطلبيات/الحالات)', 'Webhook événements'], ltr: true },
      { k: 'n8n_products_url', label: ['Webhook نشر المنتجات (تيليغرام)', 'Webhook produits (Telegram)'], ltr: true },
      { k: 'n8n_report_url', label: ['Webhook التقرير الصباحي', 'Webhook rapport du matin'], ltr: true },
      { k: 'n8n_backup_url', label: ['Webhook النسخ الاحتياطي (Google Drive)', 'Webhook sauvegarde (Google Drive)'], ltr: true },
      { k: 'n8n_sheets_url', label: ['جسر Google Sheets', 'Pont Google Sheets'], ltr: true },
      { k: 'n8n_sheets_key', label: ['مفتاح الجسر (x-erp-key)', 'Clé du pont (x-erp-key)'] },
      { k: 'n8n_inbound_key', label: ['مفتاح استقبال الطلبيات ‎/api/hooks/…‎', 'Clé de réception /api/hooks/…'] },
      { k: 'report_hour', label: ['ساعة التقرير', 'Heure du rapport'], type: 'number' },
    ],
  },
  {
    key: 'carriers',
    title: ['خوارزمية اختيار شركة التوصيل', 'Algorithme de choix du transporteur'],
    fields: [
      { k: 'carrier_window_days', label: ['نافذة البيانات (يوم)', 'Fenêtre (jours)'], type: 'number' },
      { k: 'carrier_weights', label: ['الأوزان', 'Pondérations'], type: 'weights' },
    ],
  },
];

function SettingInput({ def, value, onChange, id, placeholder }) {
  const { t } = useI18n();
  if (def.type === 'bool') return <Toggle checked={Boolean(value)} onChange={onChange} label={t(def.label)} />;
  if (value && typeof value === 'object' && value.secret)
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          className="ltr min-w-0 flex-1"
          value={value.next ?? ''}
          disabled={value.clear}
          placeholder={
            value.clear
              ? t(['سيُمسح عند الحفظ', 'Sera effacé à l’enregistrement'])
              : value.set
                ? `${t(['محفوظ', 'Enregistré'])} ${value.hint} — ${t(['اكتب لاستبداله', 'saisir pour remplacer'])}`
                : t(['غير محدد', 'Non défini'])
          }
          onChange={(e) => onChange({ ...value, next: e.target.value })}
        />
        {value.set && (
          <Button variant="ghost" icon={value.clear ? null : Trash2} aria-pressed={Boolean(value.clear)} onClick={() => onChange({ ...value, next: '', clear: !value.clear })}>
            {value.clear ? t(['تراجع', 'Annuler']) : t(['مسح', 'Effacer'])}
          </Button>
        )}
      </div>
    );
  if (def.type === 'enum') return <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={def.values.map((v) => ({ value: v, label: def.labels?.[v] ? t(def.labels[v]) : v || '—' }))} />;
  if (def.type === 'list') return <Input id={id} className="ltr" value={(value || []).join(', ')} onChange={(e) => onChange(e.target.value.split(/[,\s]+/).filter(Boolean).map((x) => x.replace(/^act_/, '')))} />;
  if (def.type === 'weights') {
    const w = value || {};
    return (
      <div className="grid grid-cols-4 gap-2">
        {[
          ['success', ['التسليم', 'Livraison']],
          ['speed', ['السرعة', 'Rapidité']],
          ['contact', ['الجدية', 'Sérieux']],
          ['cost', ['السعر', 'Prix']],
        ].map(([k, l]) => (
          <Field key={k} label={t(l)}>
            <Input type="number" step="0.05" min="0" max="1" value={w[k] ?? ''} onChange={(e) => onChange({ ...w, [k]: Number(e.target.value) })} />
          </Field>
        ))}
      </div>
    );
  }
  return <Input id={id} type={def.type === 'number' ? 'number' : 'text'} className={def.ltr ? 'ltr' : ''} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(def.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
}

// ——— إعداد Meta بنقرة: اختيار الحسابات والبيكسل والصفحة بالأسماء بدل نسخ المعرّفات ———
const SCOPE_USE = {
  ads_read: ['قراءة الإنفاق والنتائج', 'lire dépenses et résultats'],
  ads_management: ['إنشاء الحملات وتعديلها', 'créer et modifier les campagnes'],
  business_management: ['«اكتشاف من Meta» (الحسابات والبيكسل والصفحات)', '« Détecter depuis Meta »'],
  pages_show_list: ['اختيار الصفحة', 'choisir la page'],
  pages_read_engagement: ['منشورات الصفحة للإعلان', 'publications de la page'],
  pages_manage_posts: ['النشر على الصفحة', 'publier sur la page'],
  instagram_basic: ['حساب إنستغرام', 'compte Instagram'],
  instagram_content_publish: ['النشر على إنستغرام', 'publier sur Instagram'],
  catalog_management: ['كتالوج المنتجات', 'catalogue produits'],
};

/** نتيجة «اختبار» Meta مقروءة: كل سطر صحيح أو ناقص مع ما يجب فعله */
function MetaCheck({ result: r }) {
  const { t, lang } = useI18n();
  const row = (ok, label, detail, key) => (
    <li key={key || label} className="flex items-start gap-1.5">
      {ok === null ? <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-line" /> : ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />}
      <span className="min-w-0">
        <span className="text-ink">{label}</span>
        {detail && <span className="text-muted"> · {detail}</span>}
      </span>
    </li>
  );
  const scopeList = (list) => list.map((x) => `${x} (${t(SCOPE_USE[x] || [x, x])})`).join(lang === 'ar' ? '، ' : ', ');
  if (r?.token?.valid === false && !r.scopes) return <p className="mt-3 rounded-lg bg-bad/5 p-2 text-xs text-bad">{t(['الرمز مرفوض من Meta: أنشئ رمزاً جديداً لمستخدم النظام وضعه هنا.', 'Jeton refusé par Meta : générez un nouveau jeton System User.'])}</p>;
  return (
    <ul className="mt-3 space-y-1.5 rounded-lg border border-line p-3 text-xs">
      {r.app && row(true, t(['التطبيق', 'Application']), `${r.app.name || ''} (${r.app.id})`, 'app')}
      {row(r.token?.valid ?? null, t(['الرمز صالح', 'Jeton valide']), null, 'valid')}
      {row(r.token?.never_expires ?? null, t(['الرمز لا ينتهي', 'Jeton permanent']), r.token?.never_expires === false ? t(['ينتهي: أنشئه من «مستخدمو النظام» بمدة «أبداً»', 'Expire : générez-le depuis « Utilisateurs système », durée « Jamais »']) : null, 'expiry')}
      {r.scopes && row(!r.scopes.missing.length, t(['الصلاحيات الأساسية', 'Autorisations de base']), r.scopes.missing.length ? t(['ناقصة: {x}', 'Manquantes : {x}'], { x: scopeList(r.scopes.missing) }) : null, 'scopes')}
      {r.scopes?.optional_missing?.length > 0 && row(null, t(['صلاحيات إضافية غير مفعّلة (عند الحاجة)', 'Autorisations facultatives absentes']), scopeList(r.scopes.optional_missing), 'optional')}
      {(r.accounts || []).map((a) => row(a.ok, t(['الحساب الإعلاني', 'Compte pub']), a.error ? t(['لا وصول: أسنده لمستخدم النظام في Business Manager', 'Pas d’accès : assignez-le à l’utilisateur système']) : `${a.name || a.id}${a.ok ? '' : ` · ${t(['غير نشط', 'inactif'])}`}`, `acc-${a.id}`))}
      {!(r.accounts || []).length && row(false, t(['الحساب الإعلاني', 'Compte pub']), t(['لا حساب في المشروع: اضغط «اكتشاف من Meta»', 'Aucun compte : « Détecter depuis Meta »']), 'acc-none')}
      {r.pixel
        ? row(r.pixel.ok, t(['البيكسل', 'Pixel']), r.pixel.ok ? [r.pixel.name, r.pixel.last_fired_time && t(['آخر حدث {x}', 'dernier événement {x}'], { x: ago(r.pixel.last_fired_time, lang) }), r.pixel.events_24h?.length ? r.pixel.events_24h.map((e) => `${e.name} ${e.count}`).join(' · ') : null].filter(Boolean).join(' · ') : t(['لا وصول: أسند البيكسل (Dataset) لمستخدم النظام', 'Pas d’accès : assignez le pixel (dataset) à l’utilisateur système']), 'pixel')
        : row(false, t(['البيكسل', 'Pixel']), t(['غير محدد', 'non défini']), 'pixel')}
      {r.page ? row(r.page.ok, t(['الصفحة', 'Page']), r.page.ok ? r.page.name : t(['لا وصول: أسند الصفحة لمستخدم النظام', 'Pas d’accès : assignez la page']), 'page') : row(null, t(['الصفحة', 'Page']), t(['غير محددة', 'non définie']), 'page')}
      {r.capi
        ? row(r.capi.ok, t(['إرسال الأحداث (CAPI)', 'Envoi d’événements (CAPI)']), r.capi.ok ? t(['وصل الحدث التجريبي: افتح «اختبار الأحداث» في Events Manager لتراه، ثم امسح الرمز', 'Événement d’essai reçu : visible dans « Tester les événements », videz ensuite le code']) : r.capi.error, 'capi')
        : row(null, t(['إرسال الأحداث (CAPI)', 'Envoi d’événements (CAPI)']), t(['لتجربته: ضع رمز «اختبار الأحداث» أعلاه واحفظ ثم اختبر', 'Pour l’essayer : code « Tester les événements » ci-dessus, enregistrez, testez']), 'capi')}
    </ul>
  );
}

function MetaSetup({ projectId, tokenSet, current, onApplied }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [bm, setBm] = useState(null);
  const [bmId, setBmId] = useState('');
  const [sel, setSel] = useState([]);
  const [assets, setAssets] = useState(null);
  const [pixel, setPixel] = useState('');
  const [page, setPage] = useState('');
  const [loadErr, setLoadErr] = useState(null);
  const [done, setDone] = useState(null);
  const { run, busy } = useAction();
  const opts = { project: projectId };

  const start = async () => {
    setOpen(true);
    setDone(null);
    setLoadErr(null);
    setBm(null);
    try {
      const d = await api.get('/ads/businesses?refresh=1', opts);
      setBm(d);
      const all = d.businesses.flatMap((b) => b.accounts.map((a) => ({ ...a, bm: b.id || 'none' })));
      const linked = all.filter((a) => a.in_project);
      setSel(linked.map((a) => a.id));
      setBmId(d.selected_business || linked[0]?.bm || d.businesses[0]?.id || 'none');
    } catch (e) {
      setLoadErr(e);
    }
  };

  // أصول أول حساب مختار: البيكسلات (مع آخر حدث) والصفحات
  const main = sel[0] || '';
  useEffect(() => {
    if (!open || !main) return;
    let off = false;
    setAssets(null);
    api.get(`/ads/accounts/${main}/assets`, { project: projectId }).then(
      (a) => {
        if (off) return;
        setAssets(a);
        const fired = [...a.pixels].sort((x, y) => String(y.last_fired_time || '').localeCompare(String(x.last_fired_time || '')));
        setPixel(a.pixels.some((x) => x.id === current.pixel) ? current.pixel : fired[0]?.id || '');
        setPage(a.pages.some((x) => x.id === current.page) ? current.page : a.pages[0]?.id || '');
      },
      () => !off && setAssets({ pixels: [], pages: [] }),
    );
    return () => {
      off = true;
    };
  }, [open, main, projectId, current.pixel, current.page]);

  const businesses = bm?.businesses || [];
  const accounts = businesses.find((b) => (b.id || 'none') === bmId)?.accounts || [];
  const toggle = (id) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const apply = () =>
    run(
      'apply',
      async () => {
        const out = await api.post('/ads/meta-setup', { business_id: bmId === 'none' ? '' : bmId, ad_account_ids: sel, pixel_id: pixel || null, page_id: page || null }, { ...opts, reason: t(['ربط Meta بالمشروع', 'Connexion Meta du projet']) });
        setDone(out);
        onApplied?.();
        return out;
      },
      { success: t(['حُفظ إعداد Meta', 'Configuration Meta enregistrée']) },
    );
  const fired = (iso) => (iso && !iso.startsWith('1970') && !iso.startsWith('1969') ? t(['آخر حدث {x}', 'Dernier événement {x}'], { x: ago(iso, lang) }) : t(['لم يُستعمل', 'Jamais utilisé']));

  return (
    <>
      <Button size="sm" variant="primary" icon={Sparkles} disabled={!tokenSet} title={tokenSet ? '' : t(['احفظ رمز System User أولاً', 'Enregistrez d’abord le jeton System User'])} onClick={start}>
        {t(['اكتشاف من Meta', 'Détecter depuis Meta'])}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        icon={Sparkles}
        title={t(['ربط Meta بالمشروع', 'Connecter Meta au projet'])}
        footer={
          done ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              {t(['تم', 'OK'])}
            </Button>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('c.cancel')}
              </Button>
              <Button variant="primary" icon={Save} loading={busy === 'apply'} disabled={!sel.length} onClick={apply}>
                {t(['حفظ الاختيار', 'Enregistrer'])}
              </Button>
            </div>
          )
        }
      >
        {loadErr ? (
          <ErrorBox error={loadErr} onRetry={start} />
        ) : !bm ? (
          <Loading />
        ) : done ? (
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
              <span>{t(['الحسابات: {x}', 'Comptes : {x}'], { x: done.accounts.map((a) => `${a.name} (${a.currency})`).join('، ') })}</span>
            </li>
            {done.pixel && (
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                <span>{t(['البيكسل: {x}', 'Pixel : {x}'], { x: done.pixel.name })}</span>
              </li>
            )}
            {done.page && (
              <li className="flex items-start gap-2">
                {done.page.token ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                <span>
                  {t(['الصفحة: {x}', 'Page : {x}'], { x: done.page.name })}
                  {!done.page.token && <span className="block text-xs text-sub">{t(['رمز الصفحة لم يُجلب: في Business Manager أسند الصفحة لمستخدم النظام (مهام «إنشاء المحتوى») ثم أعد المحاولة.', 'Jeton de page non obtenu : assignez la page à l’utilisateur système dans Business Manager puis réessayez.'])}</span>}
                </span>
              </li>
            )}
            <li className="flex items-start gap-2">
              {done.instagram ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              <span>{done.instagram ? t(['إنستغرام: @{x}', 'Instagram : @{x}'], { x: done.instagram.username || done.instagram.id }) : t(['لا حساب إنستغرام مرتبط بهذه الصفحة', 'Aucun compte Instagram lié à cette page'])}</span>
            </li>
          </ul>
        ) : !businesses.length ? (
          <p className="text-sm text-sub">{t(['الرمز لا يرى أي حساب إعلاني. في Business Manager أسند الحسابات لمستخدم النظام.', 'Le jeton ne voit aucun compte. Assignez les comptes à l’utilisateur système.'])}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <Field label={t(['Business Manager', 'Business Manager'])}>
              <Select value={bmId} onChange={(e) => setBmId(e.target.value)} options={businesses.map((b) => ({ value: b.id || 'none', label: `${b.name || t(['حسابات خارج BM', 'Hors BM'])} (${b.accounts.length})` }))} />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-sub">{t(['الحسابات الإعلانية لهذا المشروع', 'Comptes pub de ce projet'])}</legend>
              <div className="space-y-1">
                {accounts.map((a) => (
                  <label key={a.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2', sel.includes(a.id) && 'border-brand bg-brand/5')}>
                    <input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-[var(--brand,#0f766e)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="ltr block text-start text-xs text-muted">
                        {a.id} · {a.currency}
                      </span>
                    </span>
                    <Badge tone={a.status === 1 ? 'good' : 'bad'}>{a.status === 1 ? t(['نشط', 'Actif']) : t(['متوقف', 'Inactif'])}</Badge>
                  </label>
                ))}
              </div>
            </fieldset>
            {main && (
              <>
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-sub">{t(['البيكسل (Dataset) — نفس الذي يستعمله المتجر و n8n', 'Pixel (dataset) — le même que la boutique et n8n'])}</legend>
                  {!assets ? (
                    <Loading />
                  ) : assets.pixels.length ? (
                    <div className="space-y-1">
                      {assets.pixels.map((x) => (
                        <label key={x.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2', pixel === x.id && 'border-brand bg-brand/5')}>
                          <input type="radio" name="pixel" checked={pixel === x.id} onChange={() => setPixel(x.id)} className="h-4 w-4" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{x.name}</span>
                            <span className="block text-xs text-muted">
                              <span className="ltr">{x.id}</span> · {fired(x.last_fired_time)}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">{t(['لا بيكسل مرتبط بهذا الحساب.', 'Aucun pixel lié à ce compte.'])}</p>
                  )}
                </fieldset>
                <Field label={t(['الصفحة (للنشر ومنشوراتها، وإنستغرام المرتبط بها)', 'Page (publication, Instagram lié)'])}>
                  <Select value={page} onChange={(e) => setPage(e.target.value)} placeholder={t(['— بدون صفحة —', '— Sans page —'])} options={(assets?.pages || []).map((x) => ({ value: x.id, label: x.name }))} />
                </Field>
              </>
            )}
            <p className="text-xs text-sub">{t(['رمز الصفحة ومعرّف إنستغرام يُجلبان تلقائياً عند الحفظ. لا شيء يُنشر ولا يُصرف.', 'Le jeton de page et l’ID Instagram sont récupérés automatiquement. Rien n’est publié ni dépensé.'])}</p>
          </div>
        )}
      </Modal>
    </>
  );
}

function SettingsForm({ groups, load, save, projectId }) {
  const { t, err } = useI18n();
  const { run, busy } = useAction();
  const { data, error, loading, reload } = useApi(load);
  const [vals, setVals] = useState(null);
  const [tests, setTests] = useState({});
  useEffect(() => {
    if (data) setVals(JSON.parse(JSON.stringify(data)));
  }, [data]);
  const changed = useMemo(() => {
    if (!data || !vals) return {};
    const out = {};
    for (const [k, v] of Object.entries(vals)) {
      if (v && typeof v === 'object' && v.secret) {
        if (v.clear) out[k] = null;
        else if (v.next !== undefined && v.next !== '') out[k] = v.next;
      } else if (JSON.stringify(v) !== JSON.stringify(data[k])) out[k] = v === '' ? null : v;
    }
    return out;
  }, [data, vals]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!vals) return null;
  const doSave = async () => {
    const r = await run('save', () => api.put(save, changed));
    if (r) reload(true);
  };
  const test = async (service) => {
    setTests((x) => ({ ...x, [service]: { loading: true } }));
    try {
      const r = await api.post(`/settings/test/${service}`, { project_id: projectId });
      setTests((x) => ({ ...x, [service]: r }));
    } catch (e) {
      setTests((x) => ({ ...x, [service]: { ok: false, error: e.code } }));
    }
  };
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card
          key={g.key}
          title={t(g.title)}
          actions={
            <>
              {g.key === 'meta' && projectId && (
                <MetaSetup projectId={projectId} tokenSet={Boolean(vals.meta_access_token?.set)} current={{ pixel: vals.meta_pixel_id || '', page: vals.meta_page_id || '' }} onApplied={() => reload(true)} />
              )}
              {(g.tests || (g.test ? [g.test] : [])).map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <Button size="sm" loading={tests[s]?.loading} onClick={() => test(s)}>
                    {t(['اختبار', 'Tester'])} {g.tests ? s : ''}
                  </Button>
                  {tests[s] && !tests[s].loading && (tests[s].ok ? <CheckCircle2 className="h-4 w-4 text-good" /> : <XCircle className="h-4 w-4 text-bad" title={tests[s].error} />)}
                </div>
              ))}
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            {g.fields
              .filter((f) => f.k in vals)
              .map((f) => (
                <Field key={f.k} label={f.type === 'bool' ? null : t(f.label)} hint={typeof f.hint === 'function' ? f.hint(vals, t) : f.hint ? t(f.hint) : null} className={f.type === 'weights' ? 'md:col-span-2' : ''}>
                  <SettingInput def={f} value={vals[f.k]} placeholder={f.auto ? vals._auto?.[f.k] || undefined : undefined} onChange={(v) => setVals({ ...vals, [f.k]: v })} />
                </Field>
              ))}
          </div>
          {Object.entries(tests)
            .filter(([s, r]) => (g.tests || [g.test]).includes(s) && r && !r.loading)
            .map(([s, r]) =>
              s === 'meta' && r.ok ? (
                <MetaCheck key={s} result={r.result} />
              ) : r.ok ? (
                <pre key={s} className="ltr mt-3 max-h-40 overflow-auto rounded-lg bg-good/5 p-2 text-[11px] text-good">
                  {s}: {JSON.stringify(r.result, null, 1).slice(0, 800)}
                </pre>
              ) : (
                // «shopify: shopify: shopify_auth_failed» ← رسالة تقول ماذا تفعل؛ النص الأصلي في title
                <p key={s} className="mt-3 rounded-lg bg-bad/5 p-2 text-xs text-bad" title={r.error}>
                  {err({ code: String(r.error || '').replace(/^([a-z_]+:\s*)+/i, '') })}
                </p>
              ),
            )}
        </Card>
      ))}
      <div className="sticky bottom-3 flex justify-end">
        <Button variant="primary" icon={Save} loading={busy === 'save'} disabled={!Object.keys(changed).length} onClick={doSave} className="shadow-pop">
          {t('c.save')} {Object.keys(changed).length ? `(${Object.keys(changed).length})` : ''}
        </Button>
      </div>
    </div>
  );
}

function Projects() {
  const { t } = useI18n();
  const { projects, loadProjects } = useApp();
  const { run, busy } = useAction();
  const [edit, setEdit] = useState(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', domain: '', color: '#0d9488' })}>
          {t(['مشروع جديد', 'Nouveau projet'])}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start gap-3">
              <span className="mt-1 h-4 w-4 shrink-0 rounded-full" style={{ background: p.color }} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="ltr text-xs text-muted">{p.domain || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={p.integrations.shopify ? 'good' : 'neutral'}>Shopify</Badge>
                  <Badge tone={p.integrations.meta ? 'good' : 'neutral'}>Meta</Badge>
                  <Badge tone={p.integrations.sheet ? 'good' : 'neutral'}>Sheet</Badge>
                  {p.integrations.carriers.map((c) => (
                    <Badge key={c} tone="good">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setEdit({ ...p })}>
                  {t('c.edit')}
                </Button>
                {projects.length > 1 && <Button aria-label={t('c.delete')} size="sm" variant="ghost" icon={Trash2} onClick={() => run('del', () => api.del(`/projects/${p.id}`)).then((r) => r && loadProjects())} />}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted">{t(['كل مشروع = متجر/صفحة/دومين مستقل بإعداداته وحساباته الإعلانية وشركات توصيله. «كل المشاريع» في الأعلى يجمع الأرقام.', 'Chaque projet = boutique/page/domaine avec ses propres réglages, comptes pub et transporteurs. « Tous les projets » agrège les chiffres.'])}</p>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          size="sm"
          title={edit.id ? t('c.edit') : t(['مشروع جديد', 'Nouveau projet'])}
          footer={
            <Button variant="primary" loading={busy === 's'} disabled={!edit.name?.trim()} onClick={() => run('s', () => (edit.id ? api.patch(`/projects/${edit.id}`, edit) : api.post('/projects', edit))).then((r) => r && (setEdit(null), loadProjects()))}>
              {t('c.save')}
            </Button>
          }
        >
          <div className="space-y-3">
            <Field label={t('c.name')}>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t(['الدومين', 'Domaine'])}>
              <Input className="ltr" value={edit.domain || ''} onChange={(e) => setEdit({ ...edit, domain: e.target.value })} />
            </Field>
            <Field label={t(['اللون', 'Couleur'])}>
              <input type="color" value={edit.color || '#0d9488'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="h-9 w-16 rounded border border-line bg-surface" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UsersTab() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi('/users');
  const { run, busy } = useAction();
  const [edit, setEdit] = useState(null);
  const ROLES = { admin: ['مدير', 'Admin'], manager: ['مسؤول', 'Manager'], agent: ['موظف تأكيد', 'Agent'], viewer: ['مشاهد (قراءة فقط)', 'Lecture seule'] };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEdit({ username: '', display_name: '', role: 'agent', password: '' })}>
          {t(['مستخدم جديد', 'Nouvel utilisateur'])}
        </Button>
      </div>
      <Card pad={false}>
        <table className="table">
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="font-medium">{u.display_name}</div>
                  <div className="text-xs text-muted">@{u.username}</div>
                </td>
                <td>
                  <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{t(ROLES[u.role])}</Badge>
                </td>
                <td>{u.active ? <Badge tone="good">{t('c.active')}</Badge> : <Badge tone="bad">{t(['معطّل', 'Désactivé'])}</Badge>}</td>
                <td className="text-xs text-muted">{u.last_login_at ? ago(u.last_login_at, lang) : '—'}</td>
                <td>
                  <Button size="sm" onClick={() => setEdit({ ...u, password: '' })}>
                    {t('c.edit')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="list-disc space-y-1 ps-5 text-xs text-muted">
        <li>{t(['المدير: كل شيء، بما فيه الإعدادات والمستخدمون والحذف الجماعي.', 'Admin : tout, y compris paramètres, utilisateurs et suppression en masse.'])}</li>
        <li>{t(['المسؤول: المنتجات، إنشاء صفحات الهبوط، الإعلانات والمالية؛ دون الإعدادات والمستخدمين ونشر الصفحات والحذف الجماعي.', 'Manager : produits, création des pages, pubs et finances ; sans paramètres, utilisateurs, publication des pages ni suppression en masse.'])}</li>
        <li>{t(['موظف التأكيد: الطلبيات فقط (تأكيد، لا يرد، شحن، ملاحظات) والقائمة السوداء؛ لا يعدّل المنتجات ولا الإعلانات ولا ينفق على الذكاء الاصطناعي.', 'Agent : commandes uniquement (confirmation, sans réponse, expédition, notes) et liste noire ; pas de produits, pubs ni dépenses IA.'])}</li>
        <li>{t(['المشاهد: يرى كل الأقسام ولا يغيّر أي شيء.', 'Lecture seule : voit tout, ne modifie rien.'])}</li>
        <li>{t(['العمليات الحساسة (الحذف، الأسعار، الميزانيات، الإعدادات) تتطلب كلمة المرور الحساسة كل مرة، حتى للمدير. لا تعطها لأحد.', 'Les actions sensibles (suppression, prix, budgets, paramètres) exigent le mot de passe sensible à chaque fois, même pour l’admin. Ne le donnez à personne.'])}</li>
      </ul>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          size="sm"
          title={edit.id ? t('c.edit') : t(['مستخدم جديد', 'Nouvel utilisateur'])}
          footer={
            <Button
              variant="primary"
              loading={busy === 's'}
              onClick={() =>
                run('s', () => (edit.id ? api.patch(`/users/${edit.id}`, { display_name: edit.display_name, role: edit.role, active: edit.active, password: edit.password || undefined }) : api.post('/users', edit))).then(
                  (r) => r && (setEdit(null), reload(true)),
                )
              }
            >
              {t('c.save')}
            </Button>
          }
        >
          <div className="space-y-3">
            {!edit.id && (
              <Field label={t('auth.username')}>
                <Input className="ltr" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />
              </Field>
            )}
            <Field label={t('auth.displayName')}>
              <Input value={edit.display_name || ''} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} />
            </Field>
            <Field label={t(['الدور', 'Rôle'])}>
              <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={Object.entries(ROLES).map(([k, v]) => ({ value: k, label: t(v) }))} />
            </Field>
            {edit.id && <Toggle checked={Boolean(edit.active)} onChange={(v) => setEdit({ ...edit, active: v })} label={t('c.active')} />}
            <Field label={edit.id ? t(['كلمة مرور جديدة (اختياري)', 'Nouveau mot de passe (facultatif)']) : t('auth.password')} hint={t('auth.pwRule')}>
              <Input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Security() {
  const { t } = useI18n();
  const { auth } = useApp();
  const { run, busy } = useAction();
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [sens, setSens] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t(['كلمة مرور الدخول', 'Mot de passe de connexion'])} icon={KeyRound}>
        <div className="space-y-3">
          <Field label={t(['الحالية', 'Actuel'])}>
            <Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </Field>
          <Field label={t(['الجديدة', 'Nouveau'])} hint={t('auth.pwRule')}>
            <Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          </Field>
          <Button variant="primary" loading={busy === 'pw'} disabled={!pw.current_password || !pw.new_password} onClick={() => run('pw', () => api.post('/auth/change-password', pw)).then((r) => r && setPw({ current_password: '', new_password: '' }))}>
            {t('c.save')}
          </Button>
        </div>
      </Card>
      {auth.user?.role === 'admin' && (
        <Card title={t('auth.sensitive')} icon={ShieldCheck} subtitle={t(['تُطلب للحذف والأسعار والميزانيات وتفعيل الحملات والإعدادات', 'Demandé pour suppressions, prix, budgets, activations et paramètres'])}>
          <div className="space-y-3">
            <Field label={t(['الجديدة', 'Nouveau'])} hint={t('auth.pwRule')}>
              <Input type="password" autoComplete="new-password" value={sens} onChange={(e) => setSens(e.target.value)} />
            </Field>
            <Button variant="primary" loading={busy === 'sens'} disabled={!sens} onClick={() => run('sens', () => api.post('/auth/sensitive-password', { new_password: sens }, { reason: t(['أدخل كلمة المرور الحساسة الحالية', 'Saisissez le mot de passe sensible actuel']) })).then((r) => r && setSens(''))}>
              {t('c.save')}
            </Button>
          </div>
        </Card>
      )}
      <Card title={t(['نصائح الأمان', 'Conseils de sécurité'])} className="lg:col-span-2">
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-sub">
          <li>{t(['افتح الـ ERP من الخارج عبر Tailscale فقط (لا تفتح منفذ الراوتر).', 'Accédez depuis l’extérieur via Tailscale uniquement (pas de port ouvert).'])}</li>
          <li>{t(['المفاتيح السرية مشفرة (AES-256) ولا تُعرض أبداً بعد حفظها.', 'Les secrets sont chiffrés (AES-256) et jamais réaffichés.'])}</li>
          <li>{t(['نسخة احتياطية كل ليلة على الجهاز، ونسخة ثانية في مجلد Google Drive أو OneDrive عند ضبط ERP_BACKUP_MIRROR (انظر «النظام»).', 'Sauvegarde chaque nuit sur l’ordinateur, et une copie dans Google Drive / OneDrive avec ERP_BACKUP_MIRROR (voir « Système »).'])}</li>
          <li>{t(['نسيت كلمة المرور؟ من الجهاز: npm run reset-password -- اسم_المستخدم كلمة_جديدة', 'Mot de passe oublié ? Sur la machine : npm run reset-password -- utilisateur nouveau'])}</li>
        </ul>
      </Card>
    </div>
  );
}

function BackupCard({ b }) {
  const { t, lang, err } = useI18n();
  const m = b.mirror;
  const d = b.drive || {};
  const ok = b.offsite_ok;
  // الوجهة الخارجية: Google Drive عبر n8n (الـ VPS) أو مجلد سحابي (حاسوب)
  const viaDrive = d.configured || !m.configured;
  const tone = ok ? 'good' : d.configured || m.configured ? 'bad' : 'warn';
  return (
    <Card title={t(['النسخ الاحتياطية', 'Sauvegardes'])}>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-sub">{t(['على هذا الخادم (آخر 14 يوماً)', 'Sur ce serveur (14 jours)'])}</div>
          <div className="font-medium">{b.local.last ? `${b.local.last.name} · ${dateTime(b.local.last.at, lang)}` : '—'}</div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-sub">
            {viaDrive ? t(['خارج الخادم (Google Drive عبر n8n، آخر 30)', 'Hors serveur (Google Drive via n8n, 30)']) : t(['خارج الجهاز (مجلد سحابي، آخر 30)', 'Hors ordinateur (dossier cloud, 30)'])}
            <Badge tone={tone}>{ok ? t(['يعمل', 'Actif']) : tone === 'bad' ? t(['متوقف', 'En panne']) : t(['غير مفعّل', 'Inactif'])}</Badge>
          </div>
          {viaDrive ? (
            <>
              <div className="font-medium">{d.last_ok_at ? dateTime(d.last_ok_at, lang) : '—'}</div>
              {d.error && (
                <div className="break-words text-xs text-bad" title={d.error}>
                  {err({ code: d.error.replace(/^[a-z0-9_]+:\s*/i, '') })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="ltr break-all font-medium">{m.dir || '—'}</div>
              {m.last && <div className="text-xs text-muted">{`${m.last.name} · ${dateTime(m.last.at, lang)}`}</div>}
            </>
          )}
        </div>
      </div>
      {!ok && (
        <div className="mt-3 space-y-1.5 rounded-lg bg-raised p-3 text-xs text-sub">
          {d.configured ? (
            <p>
              {t([
                'لم تصل نسخة الليلة إلى Google Drive. في n8n افتح «Toureche ERP · نسخ احتياطي إلى Google Drive»، وتأكد أن حساب Google Drive متصل وأن سير العمل مفعّل، ثم اضغط «نسخة احتياطية الآن».',
                'La copie de la nuit n’est pas arrivée sur Google Drive. Dans n8n, ouvrez « Toureche ERP · sauvegarde Google Drive », vérifiez le compte Google Drive et que le workflow est actif, puis « Sauvegarder maintenant ».',
              ])}
            </p>
          ) : m.configured ? (
            <p>
              {t([
                'المجلد غير موجود أو لم يُنسخ إليه اليوم. تأكد أن تطبيق Google Drive أو OneDrive يعمل ثم اضغط «نسخة احتياطية الآن».',
                'Dossier introuvable ou pas de copie aujourd’hui. Vérifiez que Google Drive / OneDrive tourne puis « Sauvegarder maintenant ».',
              ])}
            </p>
          ) : (
            <>
              <p>
                {t([
                  'إن تعطّل الخادم تضيع البيانات. على الـ VPS: ضع رابط Webhook النسخ الاحتياطي في الإعدادات ← عام ← n8n، فتُرفع نسخة كل ليلة إلى Google Drive.',
                  'Si le serveur lâche, les données sont perdues. Sur le VPS : renseignez le webhook de sauvegarde dans Paramètres → Général → n8n ; une copie part chaque nuit sur Google Drive.',
                ])}
              </p>
              <p>{t(['على حاسوب: أضف هذا السطر إلى ملف .env (بمسار مجلد Google Drive أو OneDrive) ثم أعد تشغيل الـ ERP:', 'Sur un ordinateur : ajoutez cette ligne au fichier .env (dossier Google Drive ou OneDrive) puis redémarrez :'])}</p>
              <code className="ltr block rounded bg-surface px-2 py-1">ERP_BACKUP_MIRROR='G:\My Drive\ERP-backups'</code>
            </>
          )}
          <p>{t(['الاسترجاع: README ← «إن تعطّل الجهاز».', 'Restauration : README → « Si l’ordinateur lâche ».'])}</p>
        </div>
      )}
    </Card>
  );
}

// ——— تحديث الـ ERP من داخله (VPS) ———
const UPDATE_STEPS = [
  ['backup', ['نسخة احتياطية', 'Sauvegarde']],
  ['pull', ['جلب النسخة الجديدة', 'Téléchargement']],
  ['build', ['البناء (1–3 دقائق)', 'Construction (1–3 min)']],
  ['restart', ['إعادة التشغيل', 'Redémarrage']],
  ['verify', ['فحص التشغيل', 'Vérification']],
];
const ageMs = (iso) => (iso ? Date.now() - Date.parse(iso) : Infinity);
const short = (c) => (c ? c.slice(0, 7) : '—');

function UpdateCard() {
  const { t, lang, err } = useI18n();
  // بعد الضغط: متابعة كل 3 ثوانٍ حتى النهاية (والـ ERP يغيب دقيقة أثناء إعادة التشغيل)
  const [watch, setWatch] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const { data: s, error, loading, reload, setData } = useApi('/system/update', { interval: watch ? 3000 : 60e3 });
  const { run, busy } = useAction();
  const checked = useRef(false);

  // فحص تلقائي عند فتح الصفحة إن مرّت أكثر من ساعة على آخر فحص
  useEffect(() => {
    if (checked.current || !s?.supported || !s.agent?.installed || ageMs(s.check?.checked_at) < 3600e3) return;
    checked.current = true;
    api.post('/system/update/check', {}).then(() => setTimeout(() => reload(true), 8000), () => {});
  }, [s, reload]);

  const upd = s?.update;
  const running = Boolean(s?.pending) || upd?.state === 'running';
  // انتهى ما بدأناه: الخادم أجاب ولم يعد هناك طلب معلّق ولا تحديث جارٍ
  useEffect(() => {
    if (watch && s && !running && !error) {
      setResult(s.update);
      setWatch(null);
    }
  }, [watch, s, running, error]);

  if (loading && !s) return <Card title={t(['تحديث الـ ERP', 'Mise à jour de l’ERP'])} icon={Download}><Loading /></Card>;
  if (!s) return error ? <ErrorBox error={error} onRetry={reload} /> : null;

  // انقطاع الاتصال أثناء التحديث = الـ ERP يُعاد تشغيله
  const restarting = Boolean(watch) && Boolean(error);
  const ch = s.check;
  const upToDate = ch && !ch.error && ch.behind === 0;
  const canUpdate = s.supported && s.agent?.installed && !running && !watch && !upToDate;
  const stepIdx = UPDATE_STEPS.findIndex(([k]) => k === upd?.step);
  const tone = { ok: 'good', failed: 'bad', stale: 'bad', running: 'info' };

  const start = () =>
    run(
      'up',
      async () => {
        const out = await api.post('/system/update', {}, { reason: t(['تحديث الـ ERP', 'Mise à jour de l’ERP']) });
        // الرد فيه الطلب المعلّق: المتابعة تبدأ منه لا من حالة قديمة
        setData(out);
        setResult(null);
        setWatch({ from: s.current.commit });
        setConfirm(false);
        return out;
      },
      { success: t(['بدأ التحديث', 'Mise à jour lancée']) },
    );

  return (
    <Card
      title={t(['تحديث الـ ERP', 'Mise à jour de l’ERP'])}
      icon={Download}
      actions={
        s.supported && s.agent?.installed ? (
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === 'chk'} disabled={running || Boolean(watch)} onClick={() => run('chk', () => api.post('/system/update/check', {}), { success: t(['جارٍ البحث عن نسخة جديدة…', 'Recherche d’une nouvelle version…']) }).then(() => setTimeout(() => reload(true), 6000))}>
            {t(['فحص الآن', 'Vérifier'])}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-sub">{t(['النسخة الحالية', 'Version actuelle'])}</div>
          <div className="flex flex-wrap items-center gap-2 font-medium">
            <code className="ltr rounded bg-raised px-1.5 py-0.5 text-xs">{short(s.current.commit)}</code>
            {s.current.date && <span className="text-xs text-muted">{dateTime(s.current.date, lang)}</span>}
          </div>
          {s.current.subject && <p className="ltr line-clamp-2 break-words text-start text-xs text-muted">{s.current.subject}</p>}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-sub">{t(['آخر تحديث', 'Dernière mise à jour'])}</div>
          {upd ? (
            <>
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <span>{dateTime(upd.finished_at || upd.started_at, lang)}</span>
                <Badge tone={tone[upd.state] || 'neutral'}>
                  {upd.state === 'ok' ? t(['نجح', 'Réussie']) : upd.state === 'running' ? t(['جارٍ', 'En cours']) : t(['فشل', 'Échec'])}
                </Badge>
              </div>
              {upd.state !== 'running' && upd.error && <p className="break-words text-xs text-bad">{err({ code: upd.state === 'stale' ? 'update_interrupted' : `update_${upd.error}` })}</p>}
            </>
          ) : (
            <div className="font-medium">{s.current.built_at ? dateTime(s.current.built_at, lang) : '—'}</div>
          )}
        </div>
      </div>

      {(running || watch) && (
        <div className="mt-4 rounded-lg bg-raised p-3" aria-live="polite">
          {restarting ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
              {t(['الـ ERP يُعاد تشغيله… الصفحة تعود وحدها خلال دقيقة', 'L’ERP redémarre… la page revient seule dans une minute'])}
            </p>
          ) : s.pending ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
              {t(['بانتظار خدمة التحديث على الخادم…', 'En attente du service de mise à jour…'])}
            </p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {UPDATE_STEPS.map(([k, label], i) => (
                <li key={k} className={cx('flex items-center gap-2', i > stepIdx && 'text-muted')}>
                  {i < stepIdx ? <CheckCircle2 className="h-4 w-4 text-good" /> : i === stepIdx ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <span className="inline-block h-4 w-4 rounded-full border border-line" />}
                  {t(label)}
                </li>
              ))}
            </ol>
          )}
          {s.pending?.stuck && <p className="mt-2 text-xs text-bad">{err({ code: 'updater_not_responding' })}</p>}
        </div>
      )}

      {result && !watch && (
        <div className={cx('mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm', result.state === 'ok' ? 'bg-good/10' : 'bg-bad/5')}>
          <span className={result.state === 'ok' ? 'text-good' : 'text-bad'}>
            {result.state === 'ok' ? t(['تم التحديث إلى {c}', 'Mise à jour vers {c} terminée'], { c: short(result.to) }) : err({ code: `update_${result.error || 'interrupted'}` })}
          </span>
          {result.state === 'ok' && (
            <Button size="sm" variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>
              {t(['إعادة تحميل الصفحة', 'Recharger la page'])}
            </Button>
          )}
        </div>
      )}

      {s.supported && s.agent?.installed && !running && !watch && (
        <div className="mt-4 space-y-2">
          {!ch ? (
            <p className="text-xs text-muted">{t(['لم يتم البحث عن نسخة جديدة بعد.', 'Pas encore de vérification.'])}</p>
          ) : ch.error ? (
            <p className="text-xs text-bad">{t(['تعذّر الاتصال بـ GitHub: {e}', 'GitHub injoignable : {e}'], { e: ch.error })}</p>
          ) : ch.behind > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">{t(['{n} تغييرات جديدة', '{n} nouveautés'], { n: ch.behind })}</Badge>
                <span className="text-xs text-muted">{t(['آخر فحص {x}', 'Vérifié {x}'], { x: ago(ch.checked_at, lang) })}</span>
              </div>
              <ul className="space-y-1 text-xs text-sub">
                {ch.changes.slice(0, 5).map((c) => (
                  <li key={c.commit} className="ltr flex gap-2 text-start">
                    <code className="shrink-0 text-muted">{c.commit}</code>
                    <span className="min-w-0 break-words">{c.subject}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="good">{t(['لديك آخر نسخة', 'À jour'])}</Badge>
              <span className="text-xs text-muted">{t(['آخر فحص {x}', 'Vérifié {x}'], { x: ago(ch.checked_at, lang) })}</span>
            </div>
          )}
          <Button variant="primary" icon={Download} disabled={!canUpdate} onClick={() => setConfirm(true)}>
            {t(['تحديث الآن', 'Mettre à jour'])}
          </Button>
          {!s.agent.alive && <p className="text-xs text-bad">{err({ code: 'updater_not_responding' })}</p>}
        </div>
      )}

      {!s.supported ? (
        <p className="mt-3 rounded-lg bg-raised p-3 text-xs text-sub">
          {t(['التحديث من هنا يعمل على الـ VPS. على الحاسوب: git pull ثم npm run setup ثم أعد تشغيل الـ ERP.', 'La mise à jour d’ici fonctionne sur le VPS. Sur un ordinateur : git pull, npm run setup puis redémarrez.'])}
        </p>
      ) : !s.agent?.installed ? (
        <p className="mt-3 rounded-lg bg-raised p-3 text-xs text-sub">{err({ code: 'updater_not_installed' })}</p>
      ) : null}

      {s.log && (
        <details
          className="mt-3 text-xs"
          // النتيجة في آخر السجل (بعد مخرجات البناء): نبدأ من الأسفل
          onToggle={(e) => {
            const pre = e.currentTarget.querySelector('pre');
            if (pre) pre.scrollTop = pre.scrollHeight;
          }}
        >
          <summary className="cursor-pointer text-sub">{t(['سجل آخر تحديث', 'Journal de la dernière mise à jour'])}</summary>
          <pre className="ltr mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-raised p-2 text-start text-[11px] leading-relaxed [unicode-bidi:plaintext]">{s.log}</pre>
        </details>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        icon={Download}
        title={t(['تحديث الـ ERP الآن؟', 'Mettre à jour l’ERP maintenant ?'])}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('c.cancel')}
            </Button>
            <Button variant="primary" icon={Download} loading={busy === 'up'} onClick={start}>
              {t(['تحديث الآن', 'Mettre à jour'])}
            </Button>
          </div>
        }
      >
        <ol className="list-decimal space-y-1.5 ps-5 text-sm">
          <li>{t(['نسخة احتياطية تلقائية قبل أي تغيير.', 'Sauvegarde automatique avant tout changement.'])}</li>
          <li>{t(['جلب النسخة الجديدة من GitHub وبناؤها (1–3 دقائق). الـ ERP يبقى يعمل أثناء البناء.', 'Téléchargement et construction (1–3 min). L’ERP reste disponible pendant la construction.'])}</li>
          <li>{t(['إعادة التشغيل: الـ ERP يغيب دقيقة تقريباً.', 'Redémarrage : l’ERP est indisponible environ une minute.'])}</li>
          <li>{t(['إن لم تشتغل النسخة الجديدة، يرجع تلقائياً إلى النسخة السابقة.', 'Si la nouvelle version ne démarre pas, retour automatique à la précédente.'])}</li>
        </ol>
      </Modal>
    </Card>
  );
}

function System() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi('/system/jobs', { interval: 30e3 });
  const { run, busy } = useAction();
  const { projects, auth } = useApp();
  const admin = auth.user?.role === 'admin';
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const pname = (id) => (id ? projects.find((p) => p.id === id)?.name || id : '—');
  return (
    <div className="space-y-4">
      {admin && <UpdateCard />}
      <div className="flex flex-wrap gap-2">
        <Button
          icon={Database}
          loading={busy === 'bk'}
          onClick={() =>
            run(
              'bk',
              async () => {
                const out = await api.post('/system/backup', {});
                // النسخة المحلية وحدها لا تحمي من تعطّل الخادم: فشل النسخة الخارجية يُعرض كخطأ
                if (out.drive_error || out.mirror_error) throw Object.assign(new Error('backup_offsite_failed'), { code: 'backup_offsite_failed' });
                return out;
              },
              { success: t(['تمت النسخة الاحتياطية', 'Sauvegarde effectuée']) },
            ).then(() => reload(true))
          }
        >
          {t(['نسخة احتياطية الآن', 'Sauvegarder maintenant'])}
        </Button>
        <Button icon={Server} loading={busy === 'snap'} onClick={() => run('snap', () => api.post('/system/snapshot', {}), { success: t(['أُرسل التقرير إلى n8n', 'Rapport envoyé à n8n']) })}>
          {t(['إرسال التقرير الصباحي الآن', 'Envoyer le rapport maintenant'])}
        </Button>
      </div>
      {data.backup && <BackupCard b={data.backup} />}
      <Card title={t(['المهام الدورية', 'Tâches planifiées'])} pad={false}>
        <table className="table">
          <thead>
            <tr>
              <th>{t(['المهمة', 'Tâche'])}</th>
              <th>{t('c.project')}</th>
              <th>{t(['آخر تشغيل', 'Dernier run'])}</th>
              <th>{t(['آخر نجاح', 'Dernier succès'])}</th>
              <th>{t('c.status')}</th>
            </tr>
          </thead>
          <tbody>
            {(data.jobs || []).map((j) => (
              <tr key={`${j.job}-${j.project_id}`}>
                <td className="font-medium">{j.label || j.job}</td>
                <td className="text-xs">{pname(j.project_id)}</td>
                <td className="text-xs text-muted">{j.last_run_at ? ago(j.last_run_at, lang) : '—'}</td>
                <td className="text-xs text-muted">{j.last_ok_at ? dateTime(j.last_ok_at, lang) : '—'}</td>
                <td>{j.fail_count ? <Badge tone="bad" title={j.last_error}>{t(['فشل ×{n}', 'Échec ×{n}'], { n: j.fail_count })}</Badge> : <Badge tone="good">OK</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {data.effects?.length > 0 && (
        <Card title={t(['آثار جانبية فشلت (n8n، Shopify، CAPI)', 'Effets en échec (n8n, Shopify, CAPI)'])} pad={false}>
          <table className="table">
            <tbody>
              {data.effects.map((e, k) => (
                <tr key={k}>
                  <td className="text-xs">{e.label || e.key}</td>
                  <td className="ltr text-xs text-bad">{e.error}</td>
                  <td className="text-xs text-muted">{e.at ? ago(e.at, lang) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const { auth, projects, project } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'integrations';
  const [pid, setPid] = useState(project !== 'all' ? project : projects[0]?.id ? String(projects[0].id) : '');
  useEffect(() => {
    if (!pid && projects[0]) setPid(String(projects[0].id));
  }, [projects, pid]);
  const admin = auth.user?.role === 'admin';
  return (
    <div className="space-y-4">
      <PageHeader icon={SettingsIcon} title={t('nav.settings')} />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'integrations', label: t(['تكاملات المشروع', 'Intégrations du projet']), icon: Plug },
          ...(admin ? [{ value: 'general', label: t(['عام (AI، n8n، الصرف)', 'Général (IA, n8n, change)']), icon: SettingsIcon }] : []),
          { value: 'projects', label: t(['المشاريع', 'Projets']), icon: FolderKanban },
          ...(admin ? [{ value: 'users', label: t(['المستخدمون', 'Utilisateurs']), icon: Users }] : []),
          { value: 'security', label: t(['الأمان', 'Sécurité']), icon: ShieldCheck },
          { value: 'system', label: t(['النظام', 'Système']), icon: Server },
        ]}
      />
      {tab === 'integrations' && (
        <div className="space-y-3">
          {projects.length > 1 && (
            <Select className="w-auto" value={pid} onChange={(e) => setPid(e.target.value)} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          )}
          {pid && <SettingsForm key={pid} groups={PROJECT_GROUPS} load={`/settings/project/${pid}`} save={`/settings/project/${pid}`} projectId={Number(pid)} />}
        </div>
      )}
      {tab === 'general' && admin && <SettingsForm groups={GLOBAL_GROUPS} load="/settings/global" save="/settings/global" />}
      {tab === 'projects' && <Projects />}
      {tab === 'users' && admin && <UsersTab />}
      {tab === 'security' && <Security />}
      {tab === 'system' && <System />}
    </div>
  );
}
