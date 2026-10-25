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

const STATUS = { draft: ['مسودة', 'Brouillon', 'neutral'], running: ['يعمل', 'En cours', 'good'], paused: ['متوقف', 'En pause', 'warn'], ended: ['منتهٍ', 'Terminé', 'neutral'] };
const GOALS = { orders: ['الطلبيات', 'Commandes'], confirmed: ['الطلبيات المؤكدة', 'Commandes confirmées'], delivered: ['الطلبيات المسلّمة (الأدق)', 'Commandes livrées (le plus juste)'] };
const VERDICTS = { collecting: ['يجمع البيانات', 'Collecte en cours', 'info'], winner: ['يوجد فائز واضح', 'Gagnant clair', 'good'], no_difference: ['لا فرق حقيقي', 'Pas de vraie différence', 'warn'] };

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
            ['تضع رابطاً واحداً في الإعلان (مثل ‎/go/thermos‎). كل زائر جديد يُوجَّه إلى الصفحة A أو B أو C حسب النسبة التي تحددها، ويبقى على نفس الصفحة إن عاد. كل صفحة تُضاف لها علامة utm_content حتى تُنسب كل طلبية للصفحة التي جلبتها، ثم يقارن الـ ERP الزوار ← الطلبيات ← التأكيد ← التسليم ويحسب احتمال أن تكون كل صفحة هي الأفضل فعلاً.', 'Un seul lien dans la pub (ex. /go/thermos). Chaque nouveau visiteur est envoyé vers la page A, B ou C selon vos poids et reste sur la même page s’il revient. Chaque page reçoit un utm_content pour attribuer chaque commande, puis l’ERP compare visiteurs → commandes → confirmations → livraisons et calcule la probabilité que chaque page soit vraiment la meilleure.'],
          )}
          <span className="mt-1 block text-xs">{t(['شرط مهم (سياسة Meta): كل الصفحات تعرض نفس المنتج ونفس العرض؛ اختبر التصميم والصور والنص فقط.', 'Important (politique Meta) : toutes les pages montrent le même produit et la même offre ; testez design, visuels et texte.'])}</span>
        </div>
      </div>
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
        subtitle={t(['رابط إعلان واحد يوزّع الزوار على عدة صفحات هبوط لمعرفة أيها يجلب طلبيات مسلّمة أكثر', 'Un lien de pub qui répartit les visiteurs entre plusieurs landing pages pour trouver celle qui livre le plus'])}
        actions={
          <Button variant="primary" icon={Plus} disabled={isAll} title={isAll ? t('c.selectProject') : undefined} onClick={() => setOpen(true)}>
            {t(['اختبار جديد', 'Nouveau test'])}
          </Button>
        }
      />
      <HowItWorks />
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

function SplitForm({ open, onClose, initial }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const products = useApi('/products', { skip: !open || Boolean(initial) });
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open)
      setF(
        initial
          ? { name: initial.name, goal: initial.goal, sticky: initial.sticky, variants: initial.variants.map((v) => ({ name: v.name || '', url: v.url, weight: v.weight, active: v.active })) }
          : { name: '', product_id: '', goal: 'delivered', sticky: true, variants: [{ name: '', url: '', weight: 50, active: true }, { name: '', url: '', weight: 50, active: true }] },
      );
  }, [open, initial]);
  if (!f) return null;
  const setV = (k, patch) => setF({ ...f, variants: f.variants.map((v, j) => (j === k ? { ...v, ...patch } : v)) });
  const total = f.variants.filter((v) => v.active).reduce((s, v) => s + Number(v.weight || 0), 0);
  const save = async () => {
    const body = { ...f, product_id: f.product_id ? Number(f.product_id) : undefined, variants: f.variants.map((v) => ({ ...v, weight: Number(v.weight) })) };
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
              <Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })} placeholder={t('c.optional')} options={(products.data || []).map((p) => ({ value: p.id, label: p.title }))} />
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
          {f.variants.map((v, k) => (
            <div key={k} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[2rem_1fr_2fr_6rem_auto] sm:items-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: SERIES[k % 4] }}>
                {'ABCDEF'[k]}
              </span>
              <Input value={v.name} onChange={(e) => setV(k, { name: e.target.value })} placeholder={t(['اسم (اختياري)', 'Nom (facultatif)'])} />
              <Input className="ltr" value={v.url} onChange={(e) => setV(k, { url: e.target.value })} placeholder="https://souqnna.com/products/…" />
              <div className="flex items-center gap-1">
                <Input type="number" min="0" max="100" value={v.weight} onChange={(e) => setV(k, { weight: e.target.value })} />
                <span className="text-xs text-muted">{total ? `${Math.round((100 * Number(v.weight || 0)) / total)}%` : ''}</span>
              </div>
              <div className="flex items-center gap-1">
                <Toggle checked={v.active} onChange={(a) => setV(k, { active: a })} />
                {f.variants.length > 2 && !initial && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setF({ ...f, variants: f.variants.filter((_, j) => j !== k) })} />}
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
        <Button variant="ghost" icon={Trash2} onClick={() => run('del', () => api.del(`/splits/${s.id}`), { success: t(['حُذف', 'Supprimé']) }).then((r) => r && nav('/splits'))} />
      </div>

      <Card title={t(['الرابط الذي تضعه في الإعلان', 'Le lien à mettre dans la pub'])}>
        {s.public_url ? (
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
        {data.verdict === 'collecting' && data.visitors_needed_per_variant ? (
          <span className="text-xs text-muted">{t(['يحتاج تقريباً {n} زائراً إضافياً لكل صفحة', '≈ {n} visiteurs de plus par page'], { n: n0(data.visitors_needed_per_variant) })}</span>
        ) : null}
      </div>

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
                  {t(['الوزن', 'Poids'])} {v.weight} · {t(['من الإعلان', 'depuis pub'])} {n0(v.from_ad)} · bots {n0(v.bots)}
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
      <p className="text-xs text-muted">
        {t(['الطلبيات تُنسب عبر utm_content=', 'Attribution via utm_content='])}
        <span className="ltr">{s.slug}-a/b/c</span>
        {t([' (يحفظه Shopify ونموذج الطلب). الزواحف (روبوتات Meta…) توجَّه بنفس التوزيع لكنها لا تُحتسب.', ' (conservé par Shopify et le formulaire). Les robots sont redirigés pareil mais non comptés.'])}
      </p>
      <SplitForm open={edit} initial={edit ? s : null} onClose={(r) => (setEdit(false), r && reload(true))} />
    </div>
  );
}

const M = ({ label, value, hint }) => (
  <div className="rounded-lg bg-raised px-2 py-1.5">
    <div className="num text-sm font-semibold">{value}</div>
    <div className="text-[11px] text-muted">
      {label}
      {hint && hint !== '—' ? ` · ${hint}` : ''}
    </div>
  </div>
);
