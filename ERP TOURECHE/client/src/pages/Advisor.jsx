import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  FlaskConical,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Pencil,
  Pin,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  XCircle,
  Eye,
} from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { ago, da, dateOnly, n0 } from '../lib/format.js';
import { PageHeader, NewTaskModal } from '../components/Layout.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Select, Tabs, Textarea, cx, useAction } from '../components/ui.jsx';
import { useApp } from '../components/ProjectContext.jsx';

const AREAS = {
  confirmation: ['التأكيد', 'Confirmation'],
  delivery: ['التوصيل', 'Livraison'],
  carriers: ['شركات التوصيل', 'Transporteurs'],
  wilayas: ['الولايات', 'Wilayas'],
  products: ['المنتجات', 'Produits'],
  stock: ['المخزون', 'Stock'],
  catalog: ['المتجر وSEO', 'Boutique & SEO'],
  ads: ['الإعلانات', 'Publicité'],
  customers: ['الزبائن', 'Clients'],
  finance: ['المالية', 'Finance'],
  timing: ['الأوقات', 'Horaires'],
  splits: ['اختبار الصفحات', 'Tests de pages'],
  setup: ['الإعداد', 'Configuration'],
};
const TYPES = {
  alert: { icon: AlertTriangle, ar: 'تنبيه', fr: 'Alerte' },
  opportunity: { icon: TrendingUp, ar: 'فرصة', fr: 'Opportunité' },
  observation: { icon: Eye, ar: 'ملاحظة', fr: 'Observation' },
  achievement: { icon: Award, ar: 'إنجاز', fr: 'Réussite' },
};
const SEV = {
  critical: { tone: 'bad', bar: 'bg-bad', ar: 'حرج', fr: 'Critique' },
  high: { tone: 'warn', bar: 'bg-warn', ar: 'مهم', fr: 'Important' },
  medium: { tone: 'info', bar: 'bg-info', ar: 'متوسط', fr: 'Moyen' },
  low: { tone: 'neutral', bar: 'bg-line', ar: 'منخفض', fr: 'Faible' },
  info: { tone: 'good', bar: 'bg-good', ar: 'للعلم', fr: 'Info' },
};
const KINDS = {
  note: ['ملاحظة', 'Note'],
  lesson: ['درس مستفاد', 'Leçon'],
  idea: ['فكرة', 'Idée'],
  decision: ['قرار', 'Décision'],
  experiment: ['تجربة', 'Expérience'],
};

/** بطاقة ملاحظة واحدة من المستشار — تُستعمل هنا وفي صفحة «اليوم» */
export function InsightCard({ insight: i, compact, onChange }) {
  const { t, tl, lang } = useI18n();
  const { run, busy } = useAction();
  const [doneOpen, setDoneOpen] = useState(false);
  const [note, setNote] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const sev = SEV[i.severity] || SEV.low;
  const T = TYPES[i.type] || TYPES.observation;
  const setState = async (status, extra = {}) => {
    const ok = await run(status || 'reset', () => api.put('/advisor/insights/state', { key: i.key, status, project_id: i.project_id, ...extra }), { success: t(['تم', 'Fait']) });
    if (ok !== undefined) onChange?.();
  };
  return (
    <article className={cx('card relative flex flex-col overflow-hidden', i.hidden && 'opacity-70')}>
      <span className={cx('absolute inset-y-0 start-0 w-1', sev.bar)} />
      <div className="flex flex-1 flex-col gap-2 p-4 ps-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sev.tone} icon={T.icon}>
            {T[lang]} · {sev[lang]}
          </Badge>
          <Badge>{t(AREAS[i.area] || [i.area, i.area])}</Badge>
          {i.impact_da ? <Badge tone="brand">≈ {da(i.impact_da)}</Badge> : null}
          {i.state && <Badge tone="neutral">{i.state.status === 'done' ? t(['منفّذة', 'Faite']) : i.state.status === 'snoozed' ? t(['مؤجلة', 'Reportée']) : t(['متجاهلة', 'Ignorée'])}</Badge>}
        </div>
        <h3 className="text-sm font-semibold leading-6">{tl(i.title)}</h3>
        {i.insight && tl(i.insight) && <p className="text-xs leading-6 text-sub">{tl(i.insight)}</p>}
        {!compact && i.evidence?.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 rounded-lg bg-raised px-3 py-2 text-xs sm:grid-cols-2">
            {i.evidence.map((e, k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <dt className="truncate text-muted">{tl(e.label)}</dt>
                <dd dir="auto" className="num shrink-0 font-medium text-ink">{tl(e.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {!compact && i.advice && tl(i.advice) && (
          <p className="flex gap-2 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2 text-xs leading-6 text-ink">
            <Lightbulb className="mt-1 h-3.5 w-3.5 shrink-0 text-brand" />
            <span>{tl(i.advice)}</span>
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {i.action?.to && (
            <Link to={i.action.to} className="btn btn-sm btn-primary">
              {tl(i.action.label) || t('c.open')}
            </Link>
          )}
          {!compact && !i.hidden && (
            <>
              <Button size="sm" icon={CheckCircle2} onClick={() => setDoneOpen(true)}>
                {t(['نفّذت', 'Fait'])}
              </Button>
              <Button size="sm" icon={Clock} loading={busy === 'snoozed'} onClick={() => setState('snoozed', { days: 3 })}>
                {t(['أجّل 3 أيام', 'Reporter 3 j'])}
              </Button>
              <Button size="sm" icon={ListChecks} onClick={() => setTaskOpen(true)}>
                {t(['مهمة', 'Tâche'])}
              </Button>
              <Button size="sm" variant="ghost" icon={XCircle} loading={busy === 'dismissed'} onClick={() => setState('dismissed')}>
                {t(['تجاهل', 'Ignorer'])}
              </Button>
            </>
          )}
          {!compact && i.hidden && (
            <Button size="sm" loading={busy === 'reset'} onClick={() => setState(null)}>
              {t(['إعادة إظهار', 'Réafficher'])}
            </Button>
          )}
        </div>
      </div>
      <Modal
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        title={t(['ماذا فعلت؟', "Qu'avez-vous fait ?"])}
        icon={CheckCircle2}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDoneOpen(false)}>{t('c.cancel')}</Button>
            <Button
              variant="primary"
              loading={busy === 'done'}
              onClick={async () => {
                await setState('done', { note: note.trim() ? `${tl(i.title)} — ${note.trim()}` : null });
                setDoneOpen(false);
                setNote('');
              }}
            >
              {t('c.save')}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-sub">{t(['يُحفظ كقرار في دفتر الملاحظات حتى يقيس المستشار أثره في التقارير القادمة.', 'Enregistré comme décision dans le journal pour mesurer son effet dans les prochains rapports.'])}</p>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(['مثال: اتصلنا بكل الطلبيات القديمة وأضفنا فترة اتصال مسائية', 'Ex. : rappel de toutes les anciennes commandes + créneau du soir'])} />
      </Modal>
      <NewTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} preset={{ title: tl(i.title), notes: [tl(i.insight), tl(i.advice)].filter(Boolean).join('\n'), priority: ['critical', 'high'].includes(i.severity) ? 'high' : 'normal', project_id: i.project_id || '' }} />
    </article>
  );
}

function ScoreRing({ value, size = 92 }) {
  const v = value ?? 0;
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const color = value === null || value === undefined ? 'rgb(var(--line))' : v >= 70 ? 'rgb(var(--good))' : v >= 45 ? 'rgb(var(--warn))' : 'rgb(var(--bad))';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${v}/100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-current text-ink" style={{ fontSize: size / 4, fontWeight: 600 }}>
        {value ?? '—'}
      </text>
    </svg>
  );
}

function Scores({ s }) {
  const { t } = useI18n();
  const items = [
    { k: 'confirmation', label: t(['التأكيد', 'Confirmation']), raw: s.raw.confirmation_rate !== null ? `${s.raw.confirmation_rate}%` : '—' },
    { k: 'delivery', label: t(['التسليم', 'Livraison']), raw: s.raw.delivery_rate !== null ? `${s.raw.delivery_rate}%` : '—' },
    { k: 'profit', label: t(['الربحية', 'Rentabilité']), raw: s.raw.profit_margin !== null ? `${s.raw.profit_margin}%` : '—' },
    { k: 'catalog', label: t(['جودة الصفحات', 'Qualité des pages']), raw: s.catalog !== null ? `SEO ${s.catalog}` : '—' },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-4">
          <ScoreRing value={s.overall} />
          <div>
            <div className="text-sm font-semibold">{t(['صحة المشروع (30 يوماً)', 'Santé du projet (30 j)'])}</div>
            <div className="mt-1 max-w-[16rem] text-xs leading-5 text-sub">
              {s.overall === null
                ? t(['يحتاج المستشار بيانات طلبيات أكثر لتقييم شامل.', 'Le conseiller a besoin de plus de commandes pour une évaluation.'])
                : t(['{o} طلبية · إيراد {r} · ربح تقديري {p}', '{o} commandes · CA {r} · profit estimé {p}'], { o: n0(s.raw.orders), r: da(s.raw.revenue), p: da(s.raw.profit) })}
            </div>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((x) => (
            <div key={x.k} className="rounded-lg bg-raised px-3 py-2">
              <div className="text-xs text-sub">{x.label}</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold num">{s[x.k] ?? '—'}</span>
                <span className="text-xs text-muted num">{x.raw}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                <div className={cx('h-full rounded-full', (s[x.k] ?? 0) >= 70 ? 'bg-good' : (s[x.k] ?? 0) >= 45 ? 'bg-warn' : 'bg-bad')} style={{ width: `${s[x.k] ?? 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function InsightsTab({ data, reload }) {
  const { t, lang } = useI18n();
  const [area, setArea] = useState('');
  const [type, setType] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const list = useMemo(() => data.insights.filter((i) => (showHidden ? i.hidden : !i.hidden) && (!area || i.area === area) && (!type || i.type === type)), [data, area, type, showHidden]);
  const areas = [...new Set(data.insights.map((i) => i.area))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t(['كل المجالات', 'Tous les domaines'])} options={areas.map((a) => ({ value: a, label: t(AREAS[a] || [a, a]) }))} />
        <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} placeholder={t(['كل الأنواع', 'Tous les types'])} options={Object.entries(TYPES).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        <Button size="sm" variant={showHidden ? 'primary' : undefined} onClick={() => setShowHidden(!showHidden)}>
          {t(['المنفّذة والمؤجلة', 'Faites & reportées'])} ({data.counts.hidden})
        </Button>
      </div>
      {list.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((i) => (
            <InsightCard key={i.key + (i.project_id || '')} insight={i} onChange={reload} />
          ))}
        </div>
      ) : (
        <Empty icon={CheckCircle2} title={showHidden ? t(['لا شيء هنا', 'Rien ici']) : t(['لا ملاحظات مفتوحة — عمل ممتاز', 'Aucune remarque ouverte — excellent travail'])}>
          {t(['المستشار يعيد التحليل كلما تغيّرت البيانات.', 'Le conseiller réanalyse à chaque changement de données.'])}
        </Empty>
      )}
    </div>
  );
}

const IMPACT = { high: ['أثر كبير', 'Impact fort', 'good'], medium: ['أثر متوسط', 'Impact moyen', 'info'], low: ['أثر صغير', 'Impact faible', 'neutral'] };
const EFFORT = { low: ['جهد قليل', 'Effort faible'], medium: ['جهد متوسط', 'Effort moyen'], high: ['جهد كبير', 'Effort élevé'] };

function ReportsTab() {
  const { t, lang } = useI18n();
  const { meta } = useApp();
  const { data, error, loading, reload } = useApi('/advisor/reports');
  const { run, busy } = useAction();
  const [focus, setFocus] = useState('');
  const [sel, setSel] = useState(0);
  const [task, setTask] = useState(null);
  const generate = async () => {
    const r = await run('gen', () => api.post('/advisor/reports', { lang, focus }), { success: t(['التقرير جاهز', 'Rapport prêt']) });
    if (r) {
      await reload(true);
      setSel(0);
    }
  };
  const report = data?.[sel];
  const c = report?.content;
  return (
    <div className="space-y-4">
      <Card
        title={t(['تقرير المستشار الذكي', 'Rapport du conseiller IA'])}
        subtitle={t(['تحليل عميق لآخر 30 يوماً مقارنة بالشهر السابق: تقييم كل مجال، استنتاجات، اقتراحات مرتبة حسب الأثر، وتجارب A/B. يُولَّد تلقائياً كل سبت.', 'Analyse approfondie des 30 derniers jours vs le mois précédent : notes par domaine, conclusions, suggestions par impact et tests A/B. Généré chaque samedi.'])}
        icon={Sparkles}
      >
        {!meta?.ai_configured && <ErrorBox error={{ code: 'ai_not_configured' }} />}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Textarea className="min-h-[44px] flex-1" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={t(['اختياري: على ماذا يركز؟ مثال: لماذا ارتفعت المرتجعات في الشرق؟', 'Facultatif : focus ? Ex. pourquoi les retours augmentent à l’Est ?'])} />
          <Button variant="primary" icon={Sparkles} loading={busy === 'gen'} disabled={!meta?.ai_configured} onClick={generate}>
            {t(['توليد تقرير الآن', 'Générer maintenant'])}
          </Button>
        </div>
        {busy === 'gen' && <p className="mt-2 text-xs text-muted">{t(['يحلل المستشار أرقامك… قد يستغرق دقيقة.', 'Analyse en cours… cela peut prendre une minute.'])}</p>}
      </Card>
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data?.length > 1 && (
        <Select
          className="w-auto"
          value={sel}
          onChange={(e) => setSel(Number(e.target.value))}
          options={data.map((r, k) => ({ value: k, label: `${dateOnly(r.created_at, lang)} · ${r.period_from} → ${r.period_to}` }))}
        />
      )}
      {data && !data.length && <Empty icon={Sparkles} title={t(['لا تقارير بعد', 'Aucun rapport'])} />}
      {c && (
        <div className="space-y-4">
          <Card>
            <div className="text-xs text-muted">
              {dateOnly(report.created_at, lang)} · {report.period_from} → {report.period_to}
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-8">{c.headline}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-sub">{c.summary}</p>
          </Card>
          {c.evaluations?.length > 0 && (
            <Card title={t(['التقييمات', 'Évaluations'])} icon={Target} pad={false}>
              <div className="overflow-x-auto">
                <table className="table">
                  <tbody>
                    {c.evaluations.map((e, k) => (
                      <tr key={k}>
                        <td className="w-14">
                          <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold', { A: 'bg-good/15 text-good', B: 'bg-good/10 text-good', C: 'bg-warn/15 text-warn', D: 'bg-bad/10 text-bad', E: 'bg-bad/20 text-bad' }[e.grade])}>{e.grade}</span>
                        </td>
                        <td className="w-40 font-medium">{e.area}</td>
                        <td className="text-sm leading-6 text-sub">{e.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {c.conclusions?.length > 0 && (
            <Card title={t(['الاستنتاجات', 'Conclusions'])} icon={BookOpen}>
              <ol className="list-decimal space-y-2 ps-5 text-sm leading-7">
                {c.conclusions.map((x, k) => (
                  <li key={k}>{x}</li>
                ))}
              </ol>
            </Card>
          )}
          {c.suggestions?.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Lightbulb className="h-4 w-4 text-brand" />
                {t(['الاقتراحات', 'Suggestions'])}
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {c.suggestions.map((s, k) => (
                  <div key={k} className="card card-pad flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={IMPACT[s.impact]?.[2]}>{t(IMPACT[s.impact] || [s.impact, s.impact])}</Badge>
                      <Badge>{t(EFFORT[s.effort] || [s.effort, s.effort])}</Badge>
                      <Badge tone="brand">{s.area}</Badge>
                    </div>
                    <h4 className="text-sm font-semibold leading-6">{s.title}</h4>
                    <p className="text-xs leading-6 text-sub">
                      <b className="text-ink">{t(['لماذا: ', 'Pourquoi : '])}</b>
                      {s.why}
                    </p>
                    <p className="whitespace-pre-wrap text-xs leading-6 text-sub">
                      <b className="text-ink">{t(['كيف: ', 'Comment : '])}</b>
                      {s.how}
                    </p>
                    <div className="mt-auto pt-1">
                      <Button size="sm" icon={ListChecks} onClick={() => setTask({ title: s.title, notes: `${s.why}\n\n${s.how}`, priority: s.impact === 'high' ? 'high' : 'normal' })}>
                        {t(['حوّلها إلى مهمة', 'Créer une tâche'])}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {c.experiments?.length > 0 && (
              <Card title={t(['تجارب مقترحة', 'Expériences proposées'])} icon={FlaskConical} className="lg:col-span-2">
                <ul className="space-y-3 text-sm">
                  {c.experiments.map((x, k) => (
                    <li key={k} className="rounded-lg bg-raised p-3">
                      <div className="font-medium leading-6">{x.hypothesis}</div>
                      <div className="mt-1 text-xs leading-6 text-sub">{x.test}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        <Badge tone="info">{x.metric}</Badge>
                        <Badge>
                          {x.duration_days} {t('c.days')}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <div className="space-y-4">
              {c.watch?.length > 0 && (
                <Card title={t(['راقب هذا الأسبوع', 'À surveiller'])} icon={Eye}>
                  <ul className="list-disc space-y-1.5 ps-5 text-sm leading-6">
                    {c.watch.map((x, k) => (
                      <li key={k}>{x}</li>
                    ))}
                  </ul>
                </Card>
              )}
              {c.questions?.length > 0 && (
                <Card title={t(['أسئلة للتفكير', 'Questions à creuser'])} icon={Compass}>
                  <ul className="list-disc space-y-1.5 ps-5 text-sm leading-6">
                    {c.questions.map((x, k) => (
                      <li key={k}>{x}</li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
      <NewTaskModal open={Boolean(task)} onClose={() => setTask(null)} preset={task || {}} />
    </div>
  );
}

function JournalTab() {
  const { t, lang } = useI18n();
  const { projects, project } = useApp();
  const { data, error, loading, reload } = useApi('/advisor/journal');
  const { run, busy } = useAction();
  const [f, setF] = useState({ kind: 'note', text: '' });
  const [edit, setEdit] = useState(null);
  const [kind, setKind] = useState('');
  const add = async () => {
    const r = await run('add', () => api.post('/advisor/journal', { ...f, project_id: project === 'all' ? null : project }));
    if (r) {
      setF({ kind: f.kind, text: '' });
      reload(true);
    }
  };
  const list = (data || []).filter((j) => !kind || j.kind === kind);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title={t(['تدوين جديد', 'Nouvelle entrée'])} icon={NotebookPen} className="h-fit">
        <div className="space-y-3">
          <p className="text-xs leading-5 text-sub">{t(['دوّن القرارات والدروس والأفكار: المستشار الذكي يقرؤها ليقيّم أثر ما فعلته ويتجنب تكرار الأخطاء.', "Notez décisions, leçons et idées : le conseiller IA les lit pour mesurer l'effet de vos actions."])}</p>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v) }))} />
          <Textarea className="min-h-[120px]" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={t(['مثال: غيّرنا الصورة الأولى لمنتج الترموس إلى صورة استعمال حقيقي', 'Ex. : nouvelle première image en situation pour le thermos'])} />
          <Button variant="primary" className="w-full" loading={busy === 'add'} disabled={!f.text.trim()} onClick={add}>
            {t('c.add')}
          </Button>
        </div>
      </Card>
      <div className="space-y-3 lg:col-span-2">
        <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)} placeholder={t('c.all')} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v) }))} />
        {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
        {data && !list.length && <Empty icon={NotebookPen} title={t(['الدفتر فارغ', 'Journal vide'])} />}
        {list.map((j) => (
          <div key={j.id} className="card card-pad">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={j.kind === 'lesson' ? 'good' : j.kind === 'decision' ? 'brand' : j.kind === 'idea' ? 'warn' : j.kind === 'experiment' ? 'purple' : 'neutral'}>{t(KINDS[j.kind])}</Badge>
              {j.pinned ? <Pin className="h-3.5 w-3.5 text-brand" /> : null}
              <span>{ago(j.created_at, lang)}</span>
              {j.author && <span>· {j.author}</span>}
              {projects.length > 1 && j.project_name && <span>· {j.project_name}</span>}
              <span className="flex-1" />
              <Button aria-label={t(['تثبيت', 'Épingler'])} size="sm" variant="ghost" icon={Pin} onClick={() => run('pin', () => api.patch(`/advisor/journal/${j.id}`, { pinned: !j.pinned }), { success: false }).then(() => reload(true))} />
              <Button aria-label={t('c.edit')} size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...j })} />
              <Button aria-label={t('c.delete')} size="sm" variant="ghost" icon={Trash2} onClick={() => run('del', () => api.del(`/advisor/journal/${j.id}`)).then((r) => r && reload(true))} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{j.text}</p>
          </div>
        ))}
      </div>
      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={t('c.edit')}
        footer={
          <Button
            variant="primary"
            loading={busy === 'edit'}
            onClick={async () => {
              const r = await run('edit', () => api.patch(`/advisor/journal/${edit.id}`, { text: edit.text, kind: edit.kind }));
              if (r) {
                setEdit(null);
                reload(true);
              }
            }}
          >
            {t('c.save')}
          </Button>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label={t(['النوع', 'Type'])}>
              <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v) }))} />
            </Field>
            <Textarea className="min-h-[140px]" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Advisor() {
  const { t } = useI18n();
  const [tab, setTab] = useState('insights');
  const { data, error, loading, reload } = useApi('/advisor');
  useEffect(() => {
    const h = () => reload(true);
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
  }, [reload]);
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Compass}
        title={t('nav.advisor')}
        subtitle={t(['ملاحظات وتقييمات واستنتاجات واقتراحات من بياناتك الحقيقية — كل واحدة بالدليل وبزر التنفيذ', 'Remarques, évaluations, conclusions et suggestions tirées de vos vraies données — avec preuves et actions'])}
        actions={<Button onClick={() => reload()}>{t('c.refresh')}</Button>}
      />
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data && (
        <>
          <Scores s={data.scores} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini icon={AlertTriangle} tone="text-bad" label={t(['حرجة', 'Critiques'])} value={data.counts.critical} />
            <Mini icon={AlertTriangle} tone="text-warn" label={t(['مهمة', 'Importantes'])} value={data.counts.high} />
            <Mini icon={TrendingUp} tone="text-brand" label={t(['فرص', 'Opportunités'])} value={data.counts.opportunities} extra={data.potential_da ? `≈ ${da(data.potential_da)}` : null} />
            <Mini icon={Award} tone="text-good" label={t(['إنجازات', 'Réussites'])} value={data.counts.achievements} />
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'insights', label: t(['الملاحظات والاقتراحات', 'Remarques & suggestions']), icon: Lightbulb, count: data.insights.filter((i) => !i.hidden).length },
              { value: 'reports', label: t(['التقرير الذكي', 'Rapport IA']), icon: Sparkles },
              { value: 'journal', label: t(['دفتر الملاحظات', 'Journal']), icon: NotebookPen },
            ]}
          />
          {tab === 'insights' && <InsightsTab data={data} reload={() => reload(true)} />}
          {tab === 'reports' && <ReportsTab />}
          {tab === 'journal' && <JournalTab />}
        </>
      )}
    </div>
  );
}

function Mini({ icon: Icon, tone, label, value, extra }) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <Icon className={cx('h-5 w-5', tone)} />
      <div className="min-w-0">
        <div className="text-xs text-sub">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold num">{n0(value)}</span>
          {extra && <span className="truncate text-xs text-muted">{extra}</span>}
        </div>
      </div>
    </div>
  );
}
