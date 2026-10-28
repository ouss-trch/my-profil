import { useState } from 'react';
import { CheckCircle2, CircleHelp, Globe, Pencil, RefreshCw, Undo2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, Input, Textarea, cx, useAction } from './ui.jsx';

/**
 * أسئلة الزبائن التي لا تجيب عنها صفحة المنتج (من تحليل المنتج)، والجواب في مكانه:
 * جوابك خاصية للمنتج لا سؤال شائع: بطاقة المنتج (سطر في المواصفات + ميزة) ← تسميات وصور ميزة في الصور الوصفية،
 * فوائد صفحات الهبوط، وSEO ← «انشر الأجوبة في صفحة المنتج» يضيفه إلى وصف المنتج في Shopify (كلمة المرور الحساسة)
 * ← «حدّث الزوايا بالأجوبة».
 * blocked: سبب يمنع الحفظ الآن (مثل تعديلات غير محفوظة في بطاقة المنتج كانت ستضيع).
 */
export default function ProductQuestions({ insight, productId, project, onInsight, onProduct, onReanalyze, blocked = null }) {
  const { t, err } = useI18n();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(null); // السؤال المفتوح للجواب
  const [draft, setDraft] = useState({ answer: '', label: '' });
  const [edit, setEdit] = useState(null); // تعديل جواب محفوظ (كما يُكتب، دون Claude)
  const [failure, setFailure] = useState(null);
  const [showDismissed, setShowDismissed] = useState(false);
  if (!insight) return null;
  const opts = project ? { project } : undefined;
  const base = `/pages/landing/insight/${productId}`;
  const missing = insight.missing || [];
  const answered = insight.answered || [];
  const dismissed = insight.dismissed || [];
  const pending = answered.filter((a) => !a.on_store).length;
  const done = (r) => {
    if (!r) return r;
    onInsight(r.insight || r);
    if (r.product) onProduct?.(r.product);
    return r;
  };
  const save = (question, body) =>
    run(`a-${question}`, () => api.post(`${base}/answer`, { question, ...body }, opts).then(
      (r) => (setFailure(null), r),
      (e) => (setFailure({ question, e }), Promise.reject(e)),
    ), { success: t(['حُفظ في بطاقة المنتج', 'Enregistré dans la fiche produit']) }).then((r) => {
      if (done(r)) {
        setOpen(null);
        setEdit(null);
      }
    });
  const dismiss = (question, undo = false) => run(`d-${question}`, () => api.post(`${base}/dismiss`, { question, undo }, opts), { success: false }).then(done);
  const publish = () =>
    run('publish', () => api.post(`/products/${productId}/answers/publish`, {}, { ...opts, reason: t(['نشر الأجوبة في صفحة المنتج على Shopify', 'Publier les réponses sur la fiche Shopify']) }), {
      success: t(['أُضيفت الأجوبة إلى صفحة المنتج في المتجر', 'Réponses ajoutées à la fiche en boutique']),
    }).then((r) => {
      if (!r) return;
      onProduct?.(r);
      // المرجع بعد النشر: هل صار كل جواب ظاهراً في الصفحة؟
      api.get(`/pages/landing/insight?product_id=${productId}`, opts).then(({ insight: i }) => i && onInsight(i), () => null);
    });
  const failed = (q) => failure?.question === q && (
    <p role="alert" className="text-xs leading-6 text-bad">
      {err(failure.e)}
      {failure.e?.details?.reason ? <> — <span dir="rtl" lang="ar">{failure.e.details.reason}</span></> : null}
    </p>
  );

  if (!missing.length && !answered.length && !dismissed.length) return null;
  return (
    <div className="space-y-2.5">
      {missing.length > 0 && (
        <div className="space-y-2 rounded-lg bg-warn/10 p-2.5 text-xs leading-6">
          <p className="text-sub">
            <b className="text-ink">{t([`أسئلة يطرحها الزبون ولا تجيب عنها صفحة المنتج (${missing.length})`, `Questions de clients sans réponse sur la fiche (${missing.length})`])}</b>
            <br />
            {t(['جوابك خاصية للمنتج: يُحفظ في بطاقته (المواصفات والمميزات)، ويظهر في الصور الوصفية وفوائد صفحات الهبوط، ثم تنشره في صفحة المنتج بزر واحد. لا يُختلق شيء.', 'Votre réponse est une caractéristique du produit : enregistrée dans la fiche, montrée dans les visuels et les bénéfices des landings, puis publiée sur la fiche en un clic. Rien n’est inventé.'])}
          </p>
          {blocked && <p className="font-medium text-ink">{blocked}</p>}
          <ul className="space-y-2">
            {missing.map((m) => (
              <li key={m.question} className="space-y-2 rounded-lg bg-surface p-2.5">
                <p dir="rtl" lang="ar" className="flex items-start gap-1.5 text-sm font-medium text-ink">
                  <CircleHelp className="mt-1 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                  {m.question}
                </p>
                {open === m.question ? (
                  <div className="grid gap-2">
                    <Textarea
                      dir="auto"
                      autoFocus
                      className="min-h-[64px] text-sm"
                      aria-label={t(['جوابك', 'Votre réponse'])}
                      placeholder={m.hint ? t([`مثال: ${m.hint}`, `Ex. : ${m.hint}`]) : t(['اكتب الجواب كما تعرفه، ولو بالدارجة', 'Écrivez la réponse, même en darija'])}
                      value={draft.answer}
                      onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                    />
                    <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {t(['اسمه في جدول المواصفات:', 'Nom dans le tableau :'])}
                      <Input className="h-8 w-44 text-xs" dir="auto" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                    </label>
                    {failed(m.question)}
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="primary" loading={busy === `a-${m.question}`} disabled={!draft.answer.trim() || Boolean(blocked)} onClick={() => save(m.question, { answer: draft.answer, label: draft.label })}>
                        {busy === `a-${m.question}` ? t(['Claude يصيغ جوابك…', 'Claude met en forme…']) : t(['احفظ الجواب', 'Enregistrer'])}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => (setOpen(null), setFailure(null))}>
                        {t('c.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" disabled={Boolean(blocked)} onClick={() => (setOpen(m.question), setDraft({ answer: '', label: m.label || '' }), setFailure(null))}>
                      {t(['أجب', 'Répondre'])}
                    </Button>
                    <Button size="sm" variant="ghost" loading={busy === `d-${m.question}`} disabled={Boolean(blocked)} onClick={() => dismiss(m.question)}>
                      {t(['لا يهم', 'Sans objet'])}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {answered.length > 0 && (
        <div className="space-y-2 rounded-lg border border-good/30 bg-good/5 p-2.5 text-xs leading-6">
          <p className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-good" aria-hidden />
            <b className="text-ink">{t([`أجوبتك في بطاقة المنتج (${answered.length})`, `Vos réponses dans la fiche (${answered.length})`])}</b>
            {insight.on_shopify && (pending ? <Badge tone="warn">{t([`${pending} لم تُنشر في صفحة المنتج بعد`, `${pending} pas encore sur la fiche en ligne`])}</Badge> : <Badge tone="good">{t(['كلها في صفحة المنتج', 'Toutes sur la fiche en ligne'])}</Badge>)}
          </p>
          <ul className="space-y-1.5">
            {answered.map((a) => (
              <li key={a.question} className="rounded-lg bg-surface p-2.5">
                {edit?.question === a.question ? (
                  <div className="grid gap-2">
                    <p dir="rtl" lang="ar" className="text-muted">{a.question}</p>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                      <Input dir="auto" className="text-xs" aria-label={t(['الخاصية', 'Propriété'])} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                      <Input dir="auto" className="text-xs" aria-label={t(['القيمة', 'Valeur'])} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
                    </div>
                    <Textarea dir="auto" className="min-h-[56px] text-xs" aria-label={t(['الميزة كما تظهر في الصفحة والصور', 'L’atout tel qu’affiché sur la page et les visuels'])} placeholder={t(['الميزة كما تظهر في الصفحة والصور', 'L’atout tel qu’affiché'])} value={edit.feature} onChange={(e) => setEdit({ ...edit, feature: e.target.value })} />
                    {failed(a.question)}
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="primary" loading={busy === `a-${a.question}`} disabled={!edit.label.trim() || !edit.value.trim() || Boolean(blocked)} onClick={() => save(a.question, { exact: true, label: edit.label, value: edit.value, feature: edit.feature })}>
                        {t('c.save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => (setEdit(null), setFailure(null))}>
                        {t('c.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div dir="rtl" lang="ar" className="min-w-0 flex-1">
                      <p className="text-muted">{a.question}</p>
                      <p className="text-sm text-ink">
                        <b>{a.label}:</b> {a.value}
                      </p>
                      {a.feature ? <p className="text-sub">✓ {a.feature}</p> : insight.on_shopify && !a.on_store && <p className="text-muted">{t(['تُصاغ ميزةً عند النشر في صفحة المنتج', 'Formulée en point fort à la publication'])}</p>}
                    </div>
                    {insight.on_shopify && (a.on_store ? <Globe className="mt-1 h-3.5 w-3.5 shrink-0 text-good" aria-label={t(['في صفحة المنتج', 'Sur la fiche en ligne'])} /> : null)}
                    <Button size="sm" variant="ghost" icon={Pencil} disabled={Boolean(blocked)} aria-label={t(['تعديل', 'Modifier'])} title={t(['تعديل', 'Modifier'])} onClick={() => (setEdit({ question: a.question, label: a.label, value: a.value, feature: a.feature || '' }), setFailure(null))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {insight.on_shopify && pending > 0 && (
              <Button size="sm" variant="primary" icon={Globe} loading={busy === 'publish'} disabled={Boolean(blocked)} onClick={publish}>
                {t(['انشر الأجوبة في صفحة المنتج (Shopify)', 'Publier sur la fiche Shopify'])}
              </Button>
            )}
            {onReanalyze && insight.fresh_answers > 0 && (
              <Button size="sm" icon={RefreshCw} onClick={onReanalyze}>
                {t(['حدّث الزوايا بالأجوبة الجديدة', 'Mettre à jour les angles'])}
              </Button>
            )}
          </div>
          {insight.on_shopify && pending > 0 && (
            <p className="text-muted">{t(['النشر يضيف سطراً لكل جواب في جدول «المواصفات» وميزة في «المميزات» بوصف المنتج (ويحذف نسخها القديمة من «أسئلة شائعة»)، ولا يلمس السعر ولا الصور ولا بقية النص.', 'Ajoute une ligne par réponse dans « Caractéristiques » et un atout dans « Points forts » (et retire leurs anciennes copies de la FAQ), sans toucher prix, photos ni reste du texte.'])}</p>
          )}
        </div>
      )}

      {dismissed.length > 0 && (
        <div className="text-xs">
          <button type="button" className={cx('text-muted underline-offset-2 hover:underline')} onClick={() => setShowDismissed((x) => !x)}>
            {t([`أسئلة قلت إنها لا تهم (${dismissed.length})`, `Questions écartées (${dismissed.length})`])}
          </button>
          {showDismissed && (
            <ul className="mt-1 space-y-1">
              {dismissed.map((q) => (
                <li key={q} className="flex items-center gap-2">
                  <span dir="rtl" lang="ar" className="min-w-0 flex-1 text-sub">{q}</span>
                  <Button size="sm" variant="ghost" icon={Undo2} loading={busy === `d-${q}`} onClick={() => dismiss(q, true)}>
                    {t(['أعده', 'Rétablir'])}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
