import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, KeyRound, Plug, Plus, Save, Server, Settings as SettingsIcon, ShieldCheck, Trash2, Users, FolderKanban, CheckCircle2, XCircle } from 'lucide-react';
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
      { k: 'split_base_url', label: ['الرابط العام لاختبارات الصفحات', 'URL publique des tests de pages'], ltr: true, hint: ['مثال: https://go.souqnna.com — العنوان العام للـ ERP (Funnel/Cloudflare)', 'Ex. https://go.souqnna.com — URL publique de l’ERP'] },
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
      { k: 'meta_access_token', label: ['رمز System User (لا ينتهي)', 'Jeton System User (permanent)'], hint: ['من Business Manager ← مستخدمو النظام، بصلاحيات ads_management وads_read وbusiness_management', 'Business Manager → Utilisateurs système (ads_management, ads_read, business_management)'] },
      { k: 'meta_ad_account_ids', label: ['الحسابات الإعلانية للمشروع (افصل بفاصلة)', 'Comptes pub du projet (virgules)'], type: 'list', ltr: true, hint: ['يمكن اختيارها أيضاً من صفحة الإعلانات ← Business Manager', 'Aussi sélectionnables depuis Pubs → Business Manager'] },
      { k: 'meta_page_id', label: ['معرّف الصفحة', 'ID de la page'], ltr: true },
      { k: 'meta_page_token', label: ['رمز الصفحة (للنشر ومنشوراتها)', 'Jeton de page (publication)'] },
      { k: 'meta_ig_user_id', label: ['معرّف حساب إنستغرام', 'ID Instagram'], ltr: true },
      { k: 'meta_pixel_id', label: ['معرّف البيكسل', 'ID du pixel'], ltr: true },
      { k: 'meta_capi_delivered', label: ['إرسال حدث «طلبية سُلّمت» إلى Meta (CAPI)', 'Envoyer « commande livrée » à Meta (CAPI)'], type: 'bool', hint: ['يعلّم الخوارزمية من يستلم فعلاً لا من يطلب فقط', 'Apprend à l’algorithme qui reçoit vraiment'] },
      { k: 'meta_capi_event', label: ['اسم الحدث', "Nom de l'événement"], ltr: true },
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
    key: 'ai',
    title: ['الذكاء الاصطناعي (Claude)', 'Intelligence artificielle (Claude)'],
    test: 'ai',
    fields: [
      { k: 'anthropic_api_key', label: ['مفتاح Claude API', 'Clé API Claude'] },
      { k: 'ai_model', label: ['النموذج', 'Modèle'], ltr: true },
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

function SettingInput({ def, value, onChange, id }) {
  const { t } = useI18n();
  if (def.type === 'bool') return <Toggle checked={Boolean(value)} onChange={onChange} label={t(def.label)} />;
  if (value && typeof value === 'object' && value.secret)
    return (
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        className="ltr"
        value={value.next ?? ''}
        placeholder={value.set ? `${t(['محفوظ', 'Enregistré'])} ${value.hint} — ${t(['اكتب لاستبداله', 'saisir pour remplacer'])}` : t(['غير محدد', 'Non défini'])}
        onChange={(e) => onChange({ ...value, next: e.target.value })}
      />
    );
  if (def.type === 'enum') return <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={def.values.map((v) => ({ value: v, label: v || '—' }))} />;
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
  return <Input id={id} type={def.type === 'number' ? 'number' : 'text'} className={def.ltr ? 'ltr' : ''} value={value ?? ''} onChange={(e) => onChange(def.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
}

function SettingsForm({ groups, load, save, projectId }) {
  const { t } = useI18n();
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
        if (v.next !== undefined && v.next !== '') out[k] = v.next;
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
          actions={(g.tests || (g.test ? [g.test] : [])).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <Button size="sm" loading={tests[s]?.loading} onClick={() => test(s)}>
                {t(['اختبار', 'Tester'])} {g.tests ? s : ''}
              </Button>
              {tests[s] && !tests[s].loading && (tests[s].ok ? <CheckCircle2 className="h-4 w-4 text-good" /> : <XCircle className="h-4 w-4 text-bad" title={tests[s].error} />)}
            </div>
          ))}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {g.fields
              .filter((f) => f.k in vals)
              .map((f) => (
                <Field key={f.k} label={f.type === 'bool' ? null : t(f.label)} hint={f.hint ? t(f.hint) : null} className={f.type === 'weights' ? 'md:col-span-2' : ''}>
                  <SettingInput def={f} value={vals[f.k]} onChange={(v) => setVals({ ...vals, [f.k]: v })} />
                </Field>
              ))}
          </div>
          {Object.entries(tests)
            .filter(([s, r]) => (g.tests || [g.test]).includes(s) && r && !r.loading)
            .map(([s, r]) => (
              <pre key={s} className={cx('ltr mt-3 max-h-40 overflow-auto rounded-lg p-2 text-[11px]', r.ok ? 'bg-good/5 text-good' : 'bg-bad/5 text-bad')}>
                {s}: {r.ok ? JSON.stringify(r.result, null, 1).slice(0, 800) : r.error}
              </pre>
            ))}
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
  const ROLES = { admin: ['مدير', 'Admin'], manager: ['مسؤول', 'Manager'], agent: ['موظف تأكيد', 'Agent'] };
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
      <p className="text-xs text-muted">{t(['الموظف (Agent) يؤكد ويشحن فقط؛ المسؤول يعدّل المنتجات والإعلانات؛ المدير يملك كل شيء. العمليات الحساسة تتطلب كلمة المرور الحساسة دائماً.', 'Agent : confirmation et expédition ; Manager : produits et pubs ; Admin : tout. Les actions sensibles exigent toujours le mot de passe sensible.'])}</p>
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
  const { t, lang } = useI18n();
  const m = b.mirror;
  const ok = m.configured && m.reachable && !m.behind;
  return (
    <Card title={t(['النسخ الاحتياطية', 'Sauvegardes'])}>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-sub">{t(['على هذا الجهاز (آخر 14 يوماً)', 'Sur cet ordinateur (14 jours)'])}</div>
          <div className="font-medium">{b.local.last ? `${b.local.last.name} · ${dateTime(b.local.last.at, lang)}` : '—'}</div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-sub">
            {t(['خارج الجهاز (مجلد سحابي، آخر 30)', 'Hors ordinateur (dossier cloud, 30)'])}
            <Badge tone={ok ? 'good' : m.configured ? 'bad' : 'warn'}>{ok ? t(['يعمل', 'Actif']) : m.configured ? t(['متوقف', 'En panne']) : t(['غير مفعّل', 'Inactif'])}</Badge>
          </div>
          <div className="ltr break-all font-medium">{m.dir || '—'}</div>
          {m.last && <div className="text-xs text-muted">{`${m.last.name} · ${dateTime(m.last.at, lang)}`}</div>}
        </div>
      </div>
      {!ok && (
        <div className="mt-3 space-y-1.5 rounded-lg bg-raised p-3 text-xs text-sub">
          <p>
            {m.configured
              ? t(['المجلد غير موجود أو لم يُنسخ إليه اليوم. تأكد أن تطبيق Google Drive أو OneDrive يعمل ثم اضغط «نسخة احتياطية الآن».', 'Dossier introuvable ou pas de copie aujourd’hui. Vérifiez que Google Drive / OneDrive tourne puis « Sauvegarder maintenant ».'])
              : t(['إن تعطّل الجهاز تضيع البيانات. أضف هذا السطر إلى ملف .env (بمسار مجلد Google Drive أو OneDrive) ثم أعد تشغيل الـ ERP:', 'Si l’ordinateur lâche, les données sont perdues. Ajoutez cette ligne au fichier .env (dossier Google Drive ou OneDrive) puis redémarrez :'])}
          </p>
          {!m.configured && (
            <>
              <code className="ltr block rounded bg-surface px-2 py-1">ERP_BACKUP_MIRROR='G:\My Drive\ERP-backups'</code>
              <code className="ltr block rounded bg-surface px-2 py-1">ERP_BACKUP_MIRROR='~/Library/CloudStorage/GoogleDrive-…/My Drive/ERP-backups'</code>
              <p>{t(['الاسترجاع على جهاز جديد: README ← «إن تعطّل الجهاز».', 'Restauration sur un nouvel ordinateur : README → « Si l’ordinateur lâche ».'])}</p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function System() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi('/system/jobs', { interval: 30e3 });
  const { run, busy } = useAction();
  const { projects } = useApp();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const pname = (id) => (id ? projects.find((p) => p.id === id)?.name || id : '—');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={Database} loading={busy === 'bk'} onClick={() => run('bk', () => api.post('/system/backup', {}), { success: t(['تمت النسخة الاحتياطية', 'Sauvegarde effectuée']) }).then(() => reload(true))}>
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
