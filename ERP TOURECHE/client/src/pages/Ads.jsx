import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Gauge,
  Link2,
  Megaphone,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced, useLocalStorage } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { ago, da, dateOnly, money, n0, n2, pct } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, Loading, Modal, Segmented, Select, Stat, Tabs, Textarea, Toggle, cx, useAction } from '../components/ui.jsx';
import CtaField from '../components/CtaField.jsx';
import LaunchCampaign, { LaunchButton } from '../components/LaunchCampaign.jsx';
import FxEditor from '../components/FxEditor.jsx';
import { VERDICT } from './ProductEditor.jsx';
import { TEST_STAGES } from './Products.jsx';

const GROUPS = {
  active: ['قيد التشغيل', 'Active', 'good'],
  paused: ['متوقفة', 'En pause', 'neutral'],
  review: ['قيد المراجعة', 'En examen', 'info'],
  issues: ['مرفوضة / بها مشكلة', 'Refusée / erreur', 'bad'],
  archived: ['مؤرشفة', 'Archivée', 'neutral'],
};
const DIAG = {
  ok: ['جيدة', 'OK', 'good'],
  not_enough_data: ['بيانات قليلة', 'Peu de données', 'neutral'],
  weak_hook: ['خطّاف ضعيف (CTR منخفض)', 'Accroche faible (CTR bas)', 'warn'],
  weak_page_or_offer: ['الصفحة أو العرض ضعيف', 'Page ou offre faible', 'warn'],
  audience_fatigue: ['تعب الجمهور (تكرار مرتفع)', 'Audience fatiguée', 'warn'],
  expensive_audience: ['جمهور مكلف (CPM مرتفع)', 'Audience chère (CPM)', 'warn'],
};
// مرحلة التعلم حسب Meta: LEARNING · SUCCESS (خرجت) · FAIL (تعلم محدود)
export const LEARNING = {
  LEARNING: ['في مرحلة التعلم', 'En apprentissage', 'info'],
  SUCCESS: ['خرجت من التعلم', 'Apprentissage terminé', 'good'],
  FAIL: ['تعلم محدود', 'Apprentissage limité', 'warn'],
};
const adsManager = (accountId, campaignId) => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId}${campaignId ? `&selected_campaign_ids=${campaignId}` : ''}`;

export default function Ads() {
  const { t } = useI18n();
  const { isAll } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'campaigns';
  const { run, busy } = useAction();
  if (isAll)
    return (
      <div className="space-y-4">
        <PageHeader icon={Megaphone} title={t('nav.ads')} />
        <ErrorBox error={{ code: 'project_required' }} />
      </div>
    );
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Megaphone}
        title={t('nav.ads')}
        subtitle={t(['حملات Meta من الـ ERP: الاطلاع، التعديل، الإطلاق لأي منتج، والقرار بالطلبيات المسلّمة لا بالبيكسل', 'Campagnes Meta depuis l’ERP : consulter, modifier, lancer pour tout produit, décider sur les commandes livrées'])}
        actions={
          <>
            <FxEditor />
            <Button icon={RefreshCw} loading={busy === 'sync'} onClick={() => run('sync', () => api.post('/ads/sync', { days: 7 }), { success: t(['تمت مزامنة الحملات والإنفاق', 'Campagnes et dépenses synchronisées']) })}>
              {t(['مزامنة الإنفاق', 'Sync dépenses'])}
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'campaigns', label: t(['الحملات (Business Manager)', 'Campagnes (Business Manager)']) },
          { value: 'decisions', label: t(['القرارات', 'Décisions']) },
          { value: 'tests', label: t(['اختبارات المنتجات', 'Tests produits']) },
          { value: 'launch', label: t(['إطلاق حملة', 'Lancer']), icon: Rocket },
          { value: 'drafts', label: t(['المسودات', 'Brouillons']), icon: FileText },
          { value: 'health', label: t(['صحة الحسابات', 'Santé des comptes']), icon: ShieldCheck },
        ]}
      />
      {tab === 'campaigns' && <Explorer />}
      {tab === 'decisions' && <Decisions />}
      {tab === 'tests' && <TestsTab />}
      {tab === 'launch' && <LaunchTab />}
      {tab === 'drafts' && <Drafts />}
      {tab === 'health' && <Health />}
    </div>
  );
}

// ——— مستكشف Business Manager ———
function Explorer() {
  const { t, lang } = useI18n();
  const { project } = useApp();
  const [params, setParams] = useSearchParams();
  const bm = useApi('/ads/businesses');
  const { run, busy } = useAction();
  const [bmId, setBmId] = useLocalStorage(`erp.ads.bm.${project}`, '');
  const [accountId, setAccountId] = useLocalStorage(`erp.ads.account.${project}`, '');
  const [days, setDays] = useState('7');
  const [group, setGroup] = useState('');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [editId, setEditId] = useState(params.get('campaign'));
  const [budgetFor, setBudgetFor] = useState(null);
  const [linkFor, setLinkFor] = useState(null);

  useEffect(() => {
    if (params.get('account')) setAccountId(params.get('account'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const businesses = bm.data?.businesses || [];
  useEffect(() => {
    if (!bm.data) return;
    if (!bmId && bm.data.selected_business) setBmId(bm.data.selected_business);
    const all = businesses.flatMap((b) => b.accounts);
    if (!accountId || !all.some((a) => a.id === accountId)) {
      const first = all.find((a) => a.in_project) || all[0];
      if (first) setAccountId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bm.data]);
  const accounts = useMemo(() => (bmId ? businesses.find((b) => (b.id || 'none') === bmId)?.accounts || [] : businesses.flatMap((b) => b.accounts)), [businesses, bmId]);
  const camps = useApi(accountId ? `/ads/accounts/${accountId}/campaigns${qs({ days, archived: archived ? '1' : '' })}` : null, { skip: !accountId });
  const list = useMemo(() => (camps.data?.campaigns || []).filter((c) => (!group || c.group === group) && (!dq || c.name.toLowerCase().includes(dq.toLowerCase()))), [camps.data, group, dq]);
  const acc = camps.data?.account;
  const cur = acc?.currency;

  const chooseBm = async (v) => {
    setBmId(v);
    const first = (v ? businesses.find((b) => (b.id || 'none') === v)?.accounts : businesses.flatMap((b) => b.accounts))?.[0];
    if (first) setAccountId(first.id);
    api.put('/ads/businesses/selected', { business_id: v }).catch(() => {});
  };
  const setStatus = async (c, status) => {
    const r = await run(`st:${c.id}`, () => api.post(`/ads/campaigns/${c.id}/status`, { status }, { reason: status === 'ACTIVE' ? t(['تفعيل الحملة يبدأ الصرف من الحساب.', 'Activer démarre la dépense.']) : undefined }), {
      success: status === 'ACTIVE' ? t(['فُعّلت الحملة', 'Campagne activée']) : t(['أُوقفت الحملة', 'Campagne en pause']),
    });
    if (r) camps.reload(true);
  };

  if (bm.loading && !bm.data) return <Loading />;
  if (bm.error) return <ErrorBox error={bm.error} onRetry={bm.reload} />;
  if (!bm.data?.configured)
    return (
      <Card>
        <Empty icon={Megaphone} title={t(['اربط Meta أولاً', 'Connectez Meta'])}>
          {t(['أضف رمز System User من Business Manager في الإعدادات ← التكاملات.', 'Ajoutez le jeton System User dans Paramètres → Intégrations.'])}
          <div className="mt-3">
            <Link className="btn btn-primary" to="/settings?tab=integrations">
              {t('nav.settings')}
            </Link>
          </div>
        </Empty>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Business Manager">
            <Select value={bmId} onChange={(e) => chooseBm(e.target.value)} placeholder={t(['كل الـ BM', 'Tous les BM'])} options={businesses.map((b) => ({ value: b.id || 'none', label: `${b.name || t(['حسابات خارج BM', 'Hors BM'])} (${b.accounts.length})` }))} />
          </Field>
          <Field label={t(['الحساب الإعلاني', 'Compte publicitaire'])}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}${a.in_project ? ' ✓' : ''}${a.status !== 1 ? ' ⚠' : ''}` }))} />
          </Field>
          <div className="flex items-end">
            <Button icon={RefreshCw} onClick={() => bm.reload()} title={t(['تحديث قائمة الحسابات', 'Rafraîchir les comptes'])}>
              {t('c.refresh')}
            </Button>
          </div>
        </div>
        {acc && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
            <Badge tone={acc.status === 1 ? 'good' : 'bad'}>{acc.status === 1 ? t(['الحساب نشط', 'Compte actif']) : t(['الحساب غير نشط', 'Compte inactif'])}</Badge>
            <span className="text-sub">
              {t(['إجمالي الصرف:', 'Dépensé au total :'])} {money(acc.amount_spent, cur)}
            </span>
            <span className="flex-1" />
            <Toggle
              checked={acc.in_project}
              onChange={async (v) => {
                const r = await run('link', () => api.put(`/ads/accounts/${acc.id}/project`, { linked: v }));
                if (r) {
                  camps.reload(true);
                  bm.reload(true);
                }
              }}
              label={t(['يُحتسب إنفاقه في هذا المشروع', 'Dépense comptée dans ce projet'])}
            />
            <a className="btn btn-sm" href={adsManager(acc.id)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Ads Manager
            </a>
          </div>
        )}
      </Card>

      {camps.loading && !camps.data ? (
        <Loading />
      ) : camps.error ? (
        <ErrorBox error={camps.error} onRetry={camps.reload} />
      ) : camps.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t(['الإنفاق ({d} يوم)', 'Dépense ({d} j)'], { d: days })} value={money(camps.data.totals.spend, cur)} hint={da(camps.data.totals.spend_da)} icon={CircleDollarSign} />
            <Stat label={t(['مشتريات البيكسل', 'Achats pixel'])} value={n0(camps.data.totals.purchases)} hint={camps.data.totals.purchases ? `${money(camps.data.totals.spend / camps.data.totals.purchases, cur)} / ${t(['شراء', 'achat'])}` : null} />
            <Stat label={t(['قيد التشغيل', 'Actives'])} value={n0(camps.data.groups.active || 0)} icon={Play} tone="good" />
            <Stat label={t(['بها مشاكل', 'Avec erreurs'])} value={n0(camps.data.groups.issues || 0)} icon={AlertTriangle} tone={camps.data.groups.issues ? 'bad' : undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={group}
              onChange={setGroup}
              options={[{ value: '', label: `${t('c.all')} (${camps.data.campaigns.length})` }, ...Object.entries(GROUPS).map(([k, v]) => ({ value: k, label: `${t(v)} (${camps.data.groups[k] || 0})` }))]}
            />
            <Segmented
              size="sm"
              value={days}
              onChange={setDays}
              options={[
                { value: '1', label: t(['اليوم', "Auj."]) },
                { value: '7', label: '7j' },
                { value: '14', label: '14j' },
                { value: '30', label: '30j' },
              ]}
            />
            <Toggle checked={archived} onChange={setArchived} label={t(['إظهار المؤرشفة', 'Afficher archivées'])} />
            <Input className="max-w-[14rem] py-1.5" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c.search')} />
          </div>
          <Card pad={false}>
            {list.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t(['الحملة', 'Campagne'])}</th>
                      <th>{t('c.status')}</th>
                      <th className="text-end">{t(['الميزانية/يوم', 'Budget/j'])}</th>
                      <th className="text-end">{t(['الإنفاق', 'Dépense'])}</th>
                      <th className="text-end">{t(['مشتريات', 'Achats'])}</th>
                      <th className="text-end">CTR</th>
                      <th className="text-end">CPM</th>
                      <th className="text-end">{t(['التكرار', 'Fréq.'])}</th>
                      <th>{t(['التشخيص', 'Diagnostic'])}</th>
                      <th>{t('c.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td className="min-w-[16rem]">
                          <div className="flex items-center gap-2">
                            {c.thumbnail ? <img src={c.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" /> : <span className="h-10 w-10 shrink-0 rounded bg-raised" />}
                            <div className="min-w-0">
                              <button type="button" className="link block max-w-[20rem] truncate text-start font-medium" onClick={() => setEditId(c.id)}>
                                {c.name}
                              </button>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                                {c.from_erp && <Badge tone="brand">ERP</Badge>}
                                {c.product ? (
                                  <Link className="link" to={`/products/${c.product.id}`}>
                                    {c.product.title}
                                  </Link>
                                ) : (
                                  <button type="button" className="text-muted hover:text-ink" onClick={() => setLinkFor(c)}>
                                    <Link2 className="me-0.5 inline h-3 w-3" />
                                    {t(['ربط بمنتج', 'Lier à un produit'])}
                                  </button>
                                )}
                                <span className="text-muted">· {ago(c.created_time, lang)}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge tone={GROUPS[c.group]?.[2]}>{t(GROUPS[c.group] || [c.effective_status, c.effective_status])}</Badge>
                          {c.learning && c.group === 'active' && (
                            <div className="mt-1">
                              <Badge tone={LEARNING[c.learning]?.[2]}>{t(LEARNING[c.learning] || [c.learning, c.learning])}</Badge>
                            </div>
                          )}
                          {c.issues?.length > 0 && (
                            <div className="mt-1 max-w-[14rem] truncate text-[11px] text-bad" title={c.issues.map((i) => i.feedback).join(' | ')}>
                              {c.issues[0].feedback || c.issues[0].status}
                            </div>
                          )}
                        </td>
                        <td className="num text-end">
                          <button type="button" className="link" onClick={() => setBudgetFor(c)} title={c.budget_level === 'adset' ? t(['ميزانية على مستوى المجموعات', 'Budget au niveau des ensembles']) : ''}>
                            {c.daily_budget ? money(c.daily_budget, cur) : c.lifetime_budget ? `${money(c.lifetime_budget, cur)} ∑` : '—'}
                          </button>
                          {c.budget_level === 'adset' && <div className="text-[10px] text-muted">ABO</div>}
                        </td>
                        <td className="num text-end">
                          {money(c.spend, cur)}
                          <div className="text-[11px] text-muted">{da(c.spend_da)}</div>
                        </td>
                        <td className="num text-end">
                          {n0(c.purchases)}
                          {c.cost_per_purchase !== null && <div className="text-[11px] text-muted">{money(c.cost_per_purchase, cur)}</div>}
                        </td>
                        <td className="num text-end">{pct(c.ctr, 2)}</td>
                        <td className="num text-end">{c.cpm === null ? '—' : n2(c.cpm)}</td>
                        <td className="num text-end">{c.frequency === null ? '—' : n2(c.frequency)}</td>
                        <td>
                          <Badge tone={DIAG[c.diagnosis]?.[2]}>{t(DIAG[c.diagnosis] || [c.diagnosis, c.diagnosis])}</Badge>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            {c.status === 'ACTIVE' ? (
                              <Button size="sm" icon={Pause} loading={busy === `st:${c.id}`} onClick={() => setStatus(c, 'PAUSED')} title={t(['إيقاف', 'Pause'])} />
                            ) : c.group !== 'archived' ? (
                              <Button size="sm" variant="primary" icon={Play} loading={busy === `st:${c.id}`} onClick={() => setStatus(c, 'ACTIVE')} title={t(['تفعيل', 'Activer'])} />
                            ) : null}
                            <Button size="sm" icon={Pencil} onClick={() => setEditId(c.id)} title={t('c.edit')} />
                            <a className="btn btn-sm" href={adsManager(acc.id, c.id)} target="_blank" rel="noreferrer" title="Ads Manager">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={Megaphone} title={t(['لا حملات بهذا الفلتر', 'Aucune campagne pour ce filtre'])} action={<LaunchHint />} />
            )}
          </Card>
          <p className="text-xs text-muted">
            {t(['الحكم النهائي على المنتجات في «اختبارات المنتجات» بالطلبيات المسلّمة؛ مشتريات البيكسل هنا للمتابعة فقط.', 'Le verdict produit (onglet Tests) se base sur les livraisons ; les achats pixel ici sont indicatifs.'])}
          </p>
        </>
      ) : null}
      {editId && (
        <CampaignEditor
          id={editId}
          onClose={() => {
            setEditId(null);
            if (params.get('campaign')) setParams({ tab: 'campaigns' });
          }}
          onChanged={() => camps.reload(true)}
        />
      )}
      <BudgetModal campaign={budgetFor} currency={cur} onClose={(ok) => (setBudgetFor(null), ok && camps.reload(true))} />
      <LinkProductModal campaign={linkFor} onClose={(ok) => (setLinkFor(null), ok && camps.reload(true))} />
    </div>
  );
}

function LaunchHint() {
  const { t } = useI18n();
  return (
    <Link to="/ads?tab=launch" className="btn btn-primary">
      <Rocket className="h-4 w-4" />
      {t(['إطلاق حملة لمنتج', 'Lancer une campagne'])}
    </Link>
  );
}

function BudgetModal({ campaign: c, currency, onClose }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [val, setVal] = useState({});
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (!c) return;
    setAck(false);
    if (c.budget_level === 'campaign') setVal({ [c.id]: c.daily_budget ?? '' });
    else setVal(Object.fromEntries(c.adsets.map((a) => [a.id, a.daily_budget ?? ''])));
  }, [c]);
  if (!c) return null;
  const orig = (id) => (c.budget_level === 'campaign' ? c.daily_budget : c.adsets.find((a) => a.id === id)?.daily_budget);
  const change = (id) => {
    const o = Number(orig(id));
    const v = Number(val[id]);
    return o && v ? Math.round((100 * (v - o)) / o) : null;
  };
  const big = Object.keys(val).some((id) => Math.abs(change(id) ?? 0) > 20);
  const learning = c.learning === 'LEARNING';
  const save = async () => {
    for (const [id, v] of Object.entries(val)) {
      if (v === '' || Number(v) === Number(orig(id))) continue;
      const r = await run('budget', () => api.post(`/ads/campaigns/${c.id}/budget`, { daily_budget: Number(v), adset_id: c.budget_level === 'adset' ? id : undefined }), { success: t(['عُدّلت الميزانية', 'Budget modifié']) });
      if (!r) return;
    }
    onClose(true);
  };
  const row = (id, label) => (
    <div key={id} className="space-y-1">
      <Field label={label}>
        <div className="flex gap-2">
          <Input type="number" min="1" step="0.5" value={val[id] ?? ''} onChange={(e) => setVal({ ...val, [id]: e.target.value })} />
          {orig(id) ? (
            <Button size="sm" onClick={() => setVal({ ...val, [id]: Math.round(orig(id) * 1.2 * 100) / 100 })} title={t(['زيادة آمنة', 'Hausse sûre'])}>
              +20%
            </Button>
          ) : null}
        </div>
      </Field>
      {change(id) !== null && change(id) !== 0 && (
        <div className={cx('text-xs', Math.abs(change(id)) > 20 ? 'text-bad' : 'text-good')}>
          {change(id) > 0 ? '+' : ''}
          {change(id)}% {t(['عن الميزانية الحالية', 'vs budget actuel'])} ({money(orig(id), currency)})
        </div>
      )}
    </div>
  );
  return (
    <Modal
      open
      onClose={() => onClose(false)}
      size="sm"
      title={t(['الميزانية اليومية', 'Budget journalier'])}
      icon={CircleDollarSign}
      footer={
        <Button variant="primary" loading={busy === 'budget'} disabled={big && !ack} onClick={save}>
          {t('c.save')}
        </Button>
      }
    >
      <p className="mb-3 truncate text-sm font-medium">{c.name}</p>
      {learning && (
        <p className="mb-3 rounded-lg border border-info/40 bg-info/5 p-2 text-xs leading-5">
          {t(['المجموعة ما زالت في مرحلة التعلم: Meta تنصح بعدم التعديل حتى تنتهي (≈50 نتيجة خلال 7 أيام).', "L'ensemble est en apprentissage : Meta conseille de ne pas modifier avant la fin (≈ 50 résultats / 7 j)."])}
        </p>
      )}
      <div className="space-y-3">{c.budget_level === 'campaign' ? row(c.id, `${t(['الحملة (CBO)', 'Campagne (CBO)'])} · ${currency}`) : c.adsets.map((a) => row(a.id, `${t(['مجموعة', 'Ensemble'])} ${a.id.slice(-6)} · ${a.effective_status} · ${currency}`))}</div>
      {big && (
        <div className="mt-3 space-y-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs leading-5">
          <p>
            {t(
              ['تغيير بأكثر من 20% قد تعتبره Meta «تعديلاً جوهرياً» فتعيد المجموعة إلى مرحلة التعلم (ترتفع التكلفة وتتذبذب النتائج). الآمن: +20% كحد أقصى ثم الانتظار 3–4 أيام، أو نسخ المجموعة الرابحة بميزانية جديدة.', 'Un changement de plus de 20 % peut être une « modification importante » pour Meta et relancer l’apprentissage. Sûr : +20 % max puis attendre 3–4 jours, ou dupliquer l’ensemble gagnant.'],
            )}
          </p>
          <Toggle checked={ack} onChange={setAck} label={t(['أفهم الخطر وأريد المتابعة', 'Je comprends le risque et je continue'])} />
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">{t(['المرجع: Meta Business Help — «Significant edits and the learning phase».', 'Réf. : Meta Business Help — « Significant edits and the learning phase ».'])}</p>
    </Modal>
  );
}

function LinkProductModal({ campaign, onClose }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products', { skip: !campaign });
  const [pid, setPid] = useState('');
  if (!campaign) return null;
  return (
    <Modal
      open
      onClose={() => onClose(false)}
      size="sm"
      title={t(['ربط الحملة بمنتج', 'Lier la campagne à un produit'])}
      icon={Link2}
      footer={
        <Button variant="primary" disabled={!pid} loading={busy === 'link'} onClick={() => run('link', () => api.post(`/ads/campaigns/${campaign.id}/link`, { product_id: Number(pid) })).then((r) => r && onClose(true))}>
          {t('c.save')}
        </Button>
      }
    >
      <p className="mb-2 text-xs text-sub">{t(['الربط يجعل إنفاق الحملة يُحتسب في حكم المنتج (تكلفة الطلبية المسلّمة).', 'Le lien compte la dépense dans le verdict du produit.'])}</p>
      <Select value={pid} onChange={(e) => setPid(e.target.value)} placeholder={t('c.select')} options={(products.data || []).map((p) => ({ value: p.id, label: p.title }))} />
    </Modal>
  );
}

/** محرر الحملة: كل قسم يُحفظ وحده ويُرسل مباشرة إلى Meta (يتطلب كلمة المرور الحساسة) */
function CampaignEditor({ id, onClose, onChanged }) {
  const { t } = useI18n();
  const { data, error, loading, setData } = useApi(`/ads/campaigns/${id}`);
  const { run, busy } = useAction();
  const [c, setC] = useState(null);
  const [sets, setSets] = useState([]);
  const [ads, setAds] = useState([]);
  useEffect(() => {
    if (!data) return;
    setC({ name: data.campaign.name, daily_budget: data.campaign.daily_budget ?? '' });
    setSets(data.adsets.map((a) => ({ ...a, end_time: a.end_time ? a.end_time.slice(0, 16) : '' })));
    setAds(data.ads.map((a) => ({ ...a })));
  }, [data]);
  const save = async (section, payload, key) => {
    const r = await run(key, () => api.put(`/ads/campaigns/${id}`, { section, data: payload }, { reason: section === 'activate' ? t(['تفعيل الحملة يبدأ الصرف من الحساب.', 'Activer démarre la dépense.']) : undefined }), { success: t(['أُرسل إلى Meta', 'Envoyé à Meta']) });
    if (r) {
      setData(r);
      onChanged?.();
    }
  };
  const cur = data?.currency;
  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={data ? data.campaign.name : '…'}>
      {loading && !data ? <Loading /> : <ErrorBox error={error} />}
      {data && c && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={data.campaign.effective_status === 'ACTIVE' ? 'good' : 'neutral'}>{data.campaign.effective_status}</Badge>
            <Badge>{data.campaign.objective}</Badge>
            {data.product && (
              <Link className="link text-sm" to={`/products/${data.product.id}`}>
                {data.product.title}
              </Link>
            )}
            <span className="flex-1" />
            {data.campaign.effective_status !== 'ACTIVE' ? (
              <Button variant="primary" icon={Play} loading={busy === 'act'} onClick={() => save('activate', {}, 'act')}>
                {t(['تفعيل الحملة بكل مجموعاتها وإعلاناتها', 'Activer (campagne, ensembles, pubs)'])}
              </Button>
            ) : (
              <Button icon={Pause} loading={busy === 'pause'} onClick={() => save('pause', {}, 'pause')}>
                {t(['إيقاف', 'Pause'])}
              </Button>
            )}
            <a className="btn" href={adsManager(data.campaign.account_id, id)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <p className="rounded-lg border border-info/40 bg-info/5 p-3 text-xs leading-5">
            {t(
              ['حسب Meta، هذه «تعديلات جوهرية» تعيد المجموعة إلى مرحلة التعلم: تغيير الجمهور، تغيير التصميم أو النص، إضافة إعلان جديد، تغيير استراتيجية المزايدة، أو الإيقاف 7 أيام فأكثر. تغيير الميزانية بنسبة كبيرة قد يعيدها أيضاً. عدّل بقرار واحد مدروس بدل تعديلات متتالية.', 'Selon Meta, ces « modifications importantes » relancent l’apprentissage : ciblage, créa/texte, nouvelle pub, stratégie d’enchère, pause ≥ 7 jours. Un gros changement de budget aussi. Faites une seule modification réfléchie plutôt que plusieurs.'],
            )}
          </p>
          <Card title={t(['الحملة', 'Campagne'])}>
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <Field label={t('c.name')}>
                <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
              </Field>
              <Field label={`${t(['ميزانية يومية', 'Budget/jour'])} (${cur || ''})`} hint={data.campaign.daily_budget ? null : t(['الميزانية على مستوى المجموعات', 'Budget au niveau des ensembles'])}>
                <Input type="number" disabled={!data.campaign.daily_budget} value={c.daily_budget} onChange={(e) => setC({ ...c, daily_budget: e.target.value })} />
              </Field>
              <Button variant="primary" loading={busy === 'camp'} onClick={() => save('campaign', { name: c.name, daily_budget: c.daily_budget ? Number(c.daily_budget) : undefined }, 'camp')}>
                {t('c.save')}
              </Button>
            </div>
          </Card>

          {sets.map((a, k) => (
            <Card
              key={a.id}
              title={`${t(['المجموعة الإعلانية', 'Ensemble de pubs'])} · ${a.effective_status}`}
              actions={a.learning?.status ? <Badge tone={LEARNING[a.learning.status]?.[2]}>{t(LEARNING[a.learning.status] || [a.learning.status, a.learning.status])}{a.learning.conversions !== null && a.learning.conversions !== undefined ? ` · ${a.learning.conversions}/50` : ''}</Badge> : null}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('c.name')} className="sm:col-span-3">
                  <Input value={a.name} onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} />
                </Field>
                <Field label={t(['العمر من', 'Âge min'])}>
                  <Input type="number" value={a.age_min ?? ''} onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, age_min: e.target.value } : x)))} />
                </Field>
                <Field label={t(['إلى', 'Âge max'])}>
                  <Input type="number" value={a.age_max ?? ''} onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, age_max: e.target.value } : x)))} />
                </Field>
                <Field label={t(['الجنس', 'Genre'])}>
                  <Select
                    value={a.genders?.length === 1 ? String(a.genders[0]) : ''}
                    onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, genders: e.target.value ? [Number(e.target.value)] : [] } : x)))}
                    options={[
                      { value: '', label: t(['الكل', 'Tous']) },
                      { value: '2', label: t(['نساء', 'Femmes']) },
                      { value: '1', label: t(['رجال', 'Hommes']) },
                    ]}
                  />
                </Field>
                <Field label={t(['المنصة', 'Plateforme'])}>
                  <Select
                    value={a.platform}
                    onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, platform: e.target.value } : x)))}
                    options={[
                      { value: 'both', label: 'FB + IG' },
                      { value: 'facebook', label: 'Facebook' },
                      { value: 'instagram', label: 'Instagram' },
                    ]}
                  />
                </Field>
                <Field label={t(['الدول', 'Pays'])}>
                  <Input className="ltr" value={(a.countries || []).join(',')} onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, countries: e.target.value.toUpperCase().split(/[,\s]+/).filter(Boolean) } : x)))} />
                </Field>
                <Field label={t(['تاريخ الانتهاء', 'Date de fin'])}>
                  <Input type="datetime-local" value={a.end_time || ''} onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, end_time: e.target.value } : x)))} />
                </Field>
                {!data.campaign.daily_budget && (
                  <Field label={`${t(['ميزانية يومية', 'Budget/jour'])} (${cur || ''})`}>
                    <Input type="number" value={a.daily_budget ?? ''} onChange={(e) => setSets(sets.map((x, j) => (j === k ? { ...x, daily_budget: e.target.value } : x)))} />
                  </Field>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="primary"
                  loading={busy === `set:${a.id}`}
                  onClick={() =>
                    save(
                      'adset',
                      {
                        id: a.id,
                        name: a.name,
                        age_min: a.age_min ? Number(a.age_min) : undefined,
                        age_max: a.age_max ? Number(a.age_max) : undefined,
                        genders: a.genders,
                        platform: a.platform,
                        countries: a.countries,
                        end_time: a.end_time ? new Date(a.end_time).toISOString() : null,
                        daily_budget: !data.campaign.daily_budget && a.daily_budget ? Number(a.daily_budget) : undefined,
                      },
                      `set:${a.id}`,
                    )
                  }
                >
                  {t('c.save')}
                </Button>
                {a.status === 'ACTIVE' && (
                  <Button icon={Pause} onClick={() => save('pause', { id: a.id }, `p:${a.id}`)}>
                    {t(['إيقاف المجموعة', 'Pause ensemble'])}
                  </Button>
                )}
              </div>
            </Card>
          ))}

          {ads.map((a, k) => (
            <Card key={a.id} title={`${t(['الإعلان', 'Publicité'])} · ${a.effective_status}`}>
              {a.review && Object.keys(a.review).length > 0 && (
                <div className="mb-3 rounded-lg border border-bad/40 bg-bad/5 p-2 text-xs text-bad">{JSON.stringify(a.review)}</div>
              )}
              <div className="flex gap-3">
                {a.thumbnail && <img src={a.thumbnail} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />}
                {a.kind !== 'link_ad' ? (
                  <p className="text-sm text-sub">{a.kind === 'ig_post' ? t(['إعلان من منشور إنستغرام موجود — يُعدّل النص من إنستغرام نفسه.', 'Pub depuis un post Instagram — texte modifiable sur Instagram.']) : t(['إعلان من منشور صفحة موجود — يُعدّل من الصفحة.', 'Pub depuis un post de page — texte modifiable sur la page.'])}</p>
                ) : (
                  <div className="grid flex-1 gap-3">
                    <Field label={t(['النص الأساسي', 'Texte principal'])}>
                      <Textarea value={a.message} onChange={(e) => setAds(ads.map((x, j) => (j === k ? { ...x, message: e.target.value } : x)))} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t(['العنوان (نص حر يظهر بجانب الزر)', 'Titre (texte libre affiché à côté du bouton)'])}>
                        <Input value={a.headline} onChange={(e) => setAds(ads.map((x, j) => (j === k ? { ...x, headline: e.target.value } : x)))} />
                      </Field>
                      <Field label={t(['الوصف', 'Description'])}>
                        <Input value={a.description} onChange={(e) => setAds(ads.map((x, j) => (j === k ? { ...x, description: e.target.value } : x)))} />
                      </Field>
                      <CtaField value={a.cta} onChange={(cta) => setAds(ads.map((x, j) => (j === k ? { ...x, cta } : x)))} />
                      <Field label={t(['الرابط', 'Lien'])} className="sm:col-span-2">
                        <Input className="ltr" value={a.link} onChange={(e) => setAds(ads.map((x, j) => (j === k ? { ...x, link: e.target.value } : x)))} />
                      </Field>
                    </div>
                    <div>
                      <Button variant="primary" loading={busy === `ad:${a.id}`} onClick={() => save('ad', { id: a.id, name: a.name, message: a.message, headline: a.headline, description: a.description, link: a.link, cta: a.cta, image_hash: a.image_hash, page_id: a.page_id, ig_user_id: a.ig_user_id }, `ad:${a.id}`)}>
                        {t(['حفظ (تصميم جديد يُراجعه Meta)', 'Enregistrer (nouvelle créa revue par Meta)'])}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// ——— القرارات ———
const DECISION = {
  fx_not_set: ['حدد أسعار الصرف', 'Définir les taux de change'],
  stop_test: ['أوقف الاختبار الخاسر', 'Arrêter le test perdant'],
  scale_budget: ['زِد الميزانية تدريجياً', 'Augmenter progressivement'],
  thin_margin: ['هامش ضيق', 'Marge faible'],
  ad_rejected: ['إعلان مرفوض', 'Pub refusée'],
  wrong_link: ['رابط خاطئ', 'Mauvais lien'],
  campaign_not_running: ['الحملة متوقفة والمنتج في الاختبار', 'Campagne à l’arrêt'],
  no_campaign: ['منتج في الاختبار بلا حملة', 'Produit en test sans campagne'],
  weak_page: ['صفحة المنتج ضعيفة', 'Page produit faible'],
  budget_spent_no_verdict: ['الميزانية صُرفت دون حكم', 'Budget dépensé sans verdict'],
};
const SEV_TONE = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };

function Decisions() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi('/ads/decisions');
  const { run, busy } = useAction();
  const [launch, setLaunch] = useState(null);
  const [edit, setEdit] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.length) return <Card><Empty icon={CheckCircle2} title={t(['لا قرارات مطلوبة الآن', 'Aucune décision requise'])} /></Card>;
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.id} className="card flex flex-wrap items-center gap-3 p-4">
          <Badge tone={SEV_TONE[d.severity]}>{d.severity}</Badge>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t(DECISION[d.kind] || [d.kind, d.kind])}</div>
            <div className="truncate text-xs text-sub">
              {d.title}
              {d.params?.cpd !== undefined && d.params?.cpd !== null && ` · ${t(['تكلفة المسلّمة', 'coût/livrée'])} ${da(d.params.cpd)}`}
              {d.params?.be ? ` · ${t(['حد التعادل', 'seuil'])} ${da(d.params.be)}` : ''}
              {d.params?.feedback ? ` · ${d.params.feedback}` : ''}
              {d.params?.link ? ` · ${d.params.link}` : ''}
              {d.params?.budget_next ? ` · ${t(['الزيادة الآمنة التالية', 'prochaine hausse sûre'])}: ${money(d.params.budget_now, d.params.currency)} → ${money(d.params.budget_next, d.params.currency)}` : ''}
            </div>
          </div>
          {d.action === 'stop_test' && (
            <Button variant="danger" icon={XCircle} loading={busy === d.id} onClick={() => run(d.id, () => api.post(`/ads/tests/${d.product_id}/stop`, { note: 'advisor: losing' })).then((r) => r && reload(true))}>
              {t(['إيقاف كل حملاته', 'Arrêter ses campagnes'])}
            </Button>
          )}
          {(d.action === 'launch' || d.action === 'activate') && d.product_id && (
            <Button variant="primary" icon={Rocket} onClick={() => setLaunch(d.product_id)}>
              {t(['إطلاق حملة', 'Lancer'])}
            </Button>
          )}
          {d.action === 'scale_budget' && d.campaign_ids?.length > 0 && (
            <Button icon={Pencil} onClick={() => setEdit(d.campaign_ids[0])}>
              {t(['تعديل الميزانية', 'Modifier le budget'])}
            </Button>
          )}
          {d.action === 'edit_in_ads_manager' && d.campaign_id && (
            <Button icon={Pencil} onClick={() => setEdit(d.campaign_id)}>
              {t(['تعديل الإعلان', 'Modifier la pub'])}
            </Button>
          )}
          {d.action === 'improve_page' && (
            <Link className="btn" to={`/products/${d.product_id}`}>
              {t(['تحسين الصفحة', 'Améliorer la page'])}
            </Link>
          )}
          {d.action === 'open_settings' && (
            <Link className="btn" to="/settings?tab=general">
              {t('nav.settings')}
            </Link>
          )}
          {d.product_id && !['improve_page'].includes(d.action) && (
            <Link className="btn btn-ghost btn-sm" to={`/products/${d.product_id}`}>
              {t('c.product')}
            </Link>
          )}
        </div>
      ))}
      {launch && <LaunchCampaignWrapper productId={launch} onClose={() => (setLaunch(null), reload(true))} />}
      {edit && <CampaignEditor id={edit} onClose={() => setEdit(null)} onChanged={() => reload(true)} />}
    </div>
  );
}

function LaunchCampaignWrapper({ productId, onClose }) {
  const { project } = useApp();
  return <LaunchCampaign productId={productId} projectId={project} open onClose={onClose} />;
}

function TestsTab() {
  const { t } = useI18n();
  const [days, setDays] = useState('7');
  const { data, error, loading, reload } = useApi(`/ads/tests${qs({ days })}`);
  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        value={days}
        onChange={setDays}
        options={['3', '7', '14', '30'].map((d) => ({ value: d, label: `${d} ${t(['يوم', 'j'])}` }))}
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.length ? (
        <Card>
          <Empty icon={Gauge} title={t(['لا منتجات قيد الاختبار', 'Aucun produit en test'])} action={<LaunchHint />} />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('c.product')}</th>
                  <th>{t(['المرحلة', 'Étape'])}</th>
                  <th className="text-end">{t(['الإنفاق', 'Dépense'])}</th>
                  <th className="text-end">{t('c.orders')}</th>
                  <th className="text-end">{t(['مؤكدة', 'Conf.'])}</th>
                  <th className="text-end">{t(['مسلّمة', 'Livr.'])}</th>
                  <th className="text-end">{t(['مرتجعة', 'Retours'])}</th>
                  <th className="text-end">{t(['تكلفة المسلّمة', 'Coût/livrée'])}</th>
                  <th className="text-end">{t(['حد التعادل', 'Seuil'])}</th>
                  <th className="text-end">{t(['الربح', 'Profit'])}</th>
                  <th>{t(['الحكم', 'Verdict'])}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.product_id}>
                    <td>
                      <Link to={`/products/${r.product_id}`} className="flex items-center gap-2">
                        {r.image ? <img src={r.image} alt="" className="h-9 w-9 rounded object-cover" /> : <span className="h-9 w-9 rounded bg-raised" />}
                        <span className="link max-w-[14rem] truncate">{r.title}</span>
                      </Link>
                    </td>
                    <td>
                      <Badge tone={TEST_STAGES[r.test_stage]?.[2]}>{t(TEST_STAGES[r.test_stage] || ['—', '—'])}</Badge>
                    </td>
                    <td className="num text-end">{da(r.spend_da)}</td>
                    <td className="num text-end">{n0(r.orders)}</td>
                    <td className="num text-end">{n0(r.confirmed)}</td>
                    <td className="num text-end">
                      {n0(r.delivered)}
                      {r.in_flight > 0 && <div className="text-[11px] text-muted">+{r.in_flight}</div>}
                    </td>
                    <td className="num text-end" title={r.return_cost_da ? `${t(['كلفة المرتجعات', 'Coût des retours'])}: ${da(r.return_cost_da)}` : undefined}>
                      {n0(r.returned)}
                      {r.return_rate !== null && r.return_rate !== undefined && <div className={cx('text-[11px]', r.return_rate > 30 ? 'text-bad' : 'text-muted')}>{r.return_rate}%</div>}
                    </td>
                    <td className={cx('num text-end', r.break_even && r.cost_per_delivered_da > r.break_even.da && 'text-bad')}>{da(r.cost_per_delivered_da)}</td>
                    <td
                      className="num text-end text-sub"
                      title={r.break_even ? t([`كل مسلّمة تحمل مرتجعاتها: ${da(r.break_even.return_cost)} للمرتجع (إرجاع + تغليف + ${r.break_even.loss_rate}% بضاعة ضائعة)`, `Chaque livrée porte ses retours : ${da(r.break_even.return_cost)} par retour`]) : undefined}
                    >
                      {da(r.break_even?.da)}
                    </td>
                    <td className={cx('num text-end', r.profit_da < 0 ? 'text-bad' : 'text-good')}>{da(r.profit_da)}</td>
                    <td>
                      <Badge tone={VERDICT[r.verdict]?.[2]}>{t(VERDICT[r.verdict] || [r.verdict, r.verdict])}</Badge>
                    </td>
                    <td>
                      <LaunchButton product={{ id: r.product_id, project_id: undefined }} label="" onDone={() => reload(true)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/** إطلاق حملة لأي منتج: كل منتجات المشروع (من Shopify أو المنشأة في الـ ERP) */
function LaunchTab() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const { data, loading, error, reload } = useApi(`/products${qs({ q: dq })}`);
  return (
    <div className="space-y-3">
      <Card>
        <p className="mb-3 text-sm text-sub">
          {t(['اختر أي منتج — منشور على Shopify أو ما زال قيد الإنشاء في الـ ERP — وأطلق له حملة بإعداداتك المحفوظة. المنتج غير المنشور يحتاج رابطاً (انشره أو استعمل صفحة هبوط / اختبار A/B).', 'Choisissez n’importe quel produit — publié sur Shopify ou en création — et lancez sa campagne avec vos réglages enregistrés. Un produit non publié nécessite un lien.'])}
        </p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c.search')} />
      </Card>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data || []).map((p) => (
            <div key={p.id} className="card flex items-center gap-3 p-3">
              {p.images?.[0]?.url ? <img src={p.images[0].url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="h-14 w-14 shrink-0 rounded-lg bg-raised" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {p.shopify_id ? <Badge tone="good">Shopify</Badge> : <Badge tone="warn">ERP</Badge>}
                  <span className="text-muted">{da(p.price)}</span>
                </div>
              </div>
              <LaunchButton product={p} label={t(['إطلاق', 'Lancer'])} variant="primary" onDone={() => reload(true)} />
            </div>
          ))}
          {data && !data.length && <Empty title={t(['لا منتجات', 'Aucun produit'])} />}
        </div>
      )}
    </div>
  );
}

function Drafts() {
  const { t, lang } = useI18n();
  const { project } = useApp();
  const { data, error, loading, reload } = useApi('/ads/drafts');
  const { run } = useAction();
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.length) return <Card><Empty icon={FileText} title={t(['لا مسودات', 'Aucun brouillon'])} /></Card>;
  return (
    <Card pad={false}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t('c.name')}</th>
              <th>{t('c.product')}</th>
              <th>{t('c.status')}</th>
              <th>{t('c.date')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">{d.name}</td>
                <td>{d.product_id ? <Link className="link" to={`/products/${d.product_id}`}>{d.product_title}</Link> : '—'}</td>
                <td>
                  <Badge tone={d.status === 'published' ? 'good' : d.status === 'failed' ? 'bad' : 'neutral'}>{d.status === 'published' ? t(['أُنشئت على Meta', 'Créée sur Meta']) : d.status === 'failed' ? t(['فشلت', 'Échec']) : t(['مسودة', 'Brouillon'])}</Badge>
                </td>
                <td className="text-xs text-muted">{dateOnly(d.updated_at || d.created_at, lang)}</td>
                <td>
                  <div className="flex gap-1">
                    {d.status !== 'published' && d.product_id && (
                      <Button size="sm" variant="primary" icon={Rocket} onClick={() => setOpen(d)}>
                        {t(['متابعة', 'Continuer'])}
                      </Button>
                    )}
                    {d.status !== 'published' && <Button aria-label={t('c.delete')} size="sm" variant="ghost" icon={Trash2} onClick={() => run('del', () => api.del(`/ads/drafts/${d.id}`)).then((r) => r && reload(true))} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <LaunchCampaign productId={open.product_id} projectId={project} draft={open} open onClose={() => (setOpen(null), reload(true))} />}
    </Card>
  );
}

const CHECKS = {
  account_active: ['الحساب نشط', 'Compte actif'],
  payment_method: ['وسيلة دفع مضافة', 'Moyen de paiement'],
  token_never_expires: ['الرمز لا ينتهي (وإلا فتاريخ انتهائه)', 'Jeton permanent (sinon sa date de fin)'],
  token_valid: ['الرمز صالح', 'Jeton valide'],
  pixel_set: ['البيكسل محدد', 'Pixel défini'],
  pixel_events_48h: ['البيكسل يستقبل أحداثاً (48 ساعة)', 'Pixel actif (48 h)'],
  page_set: ['الصفحة محددة', 'Page définie'],
  spend_cap_ok: ['بعيد عن حد الإنفاق', 'Loin du plafond de dépense'],
  business_verified: ['الـ Business موثّق', 'Business vérifié'],
};

function Health() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi('/ads/health');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.configured) return <Card><Empty icon={ShieldCheck} title={t(['Meta غير مربوط', 'Meta non connecté'])} /></Card>;
  return (
    <div className="space-y-4">
      {!data.fx.set && (
        <ErrorBox error={{ code: t(['حدد سعر صرف الدولار واليورو الفعلي في الإعدادات حتى تُحسب تكلفة الإعلانات بالدينار بدقة', 'Définissez les taux USD/EUR réels pour convertir correctement la dépense']) }} />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.accounts.map((a) => (
          <Card key={a.id} title={a.info?.name || a.id} subtitle={a.info ? `${a.info.currency} · ${a.info.timezone_name}` : null}>
            {a.error ? (
              <ErrorBox error={{ code: a.error }} />
            ) : (
              <div className="space-y-3">
                <ul className="space-y-1.5 text-sm">
                  {a.checks.map((c) => (
                    <li key={c.key} className="flex items-center gap-2">
                      {c.ok === null ? <span className="h-4 w-4 rounded-full border border-line" /> : c.ok ? <CheckCircle2 className="h-4 w-4 text-good" /> : <XCircle className="h-4 w-4 text-bad" />}
                      <span className="flex-1">{t(CHECKS[c.key] || [c.key, c.key])}</span>
                      {c.value !== null && c.value !== undefined && typeof c.value !== 'object' && <span className="text-xs text-muted">{String(c.value)}</span>}
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-raised p-2">
                    <div className="num font-semibold">{money(a.spend_today, a.info.currency)}</div>
                    <div className="text-muted">{t('c.today')}</div>
                  </div>
                  <div className="rounded-lg bg-raised p-2">
                    <div className="num font-semibold">{money(a.spend_month, a.info.currency)}</div>
                    <div className="text-muted">{t('c.thisMonth')}</div>
                  </div>
                  <div className="rounded-lg bg-raised p-2">
                    <div className="num font-semibold">{money(a.info.amount_spent, a.info.currency)}</div>
                    <div className="text-muted">{t(['الإجمالي', 'Total'])}</div>
                  </div>
                </div>
                {a.pixel?.events_24h?.length > 0 && (
                  <div className="text-xs text-sub">
                    {t(['أحداث البيكسل (24 ساعة):', 'Événements pixel (24 h) :'])} {a.pixel.events_24h.map((e) => `${e.name} ${e.count}`).join(' · ')}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
