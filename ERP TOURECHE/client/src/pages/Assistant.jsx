import { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, MessageSquare, Plus, Send, ShieldAlert, User, Wrench, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { Badge, Button, Card, ErrorBox, Spinner, Textarea, cx, useAction } from '../components/ui.jsx';

const SUGGESTIONS = [
  ['ماذا يجب أن أفعل اليوم لرفع المبيعات المسلّمة؟', "Que dois-je faire aujourd'hui pour augmenter les livraisons ?"],
  ['قيّم أداء إعلاناتي هذا الأسبوع بالطلبيات المسلّمة', 'Évalue mes pubs de la semaine sur les livraisons'],
  ['ما أفضل شركة توصيل لولاية وهران ولماذا؟', 'Quel transporteur pour Oran et pourquoi ?'],
  ['أي منتج أوقف وأيها أوسّع؟', 'Quel produit arrêter, lequel scaler ?'],
  ['لماذا ارتفعت المرتجعات؟', 'Pourquoi les retours augmentent ?'],
];

/** عرض نص المساعد بأمان (عناوين، قوائم، غامق) دون HTML خام */
function Rich({ text }) {
  const lines = String(text || '').split('\n');
  const inline = (s, k) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <b key={`${k}-${i}`} className="text-ink">
          {part.slice(2, -2)}
        </b>
      ) : (
        <span key={`${k}-${i}`}>{part}</span>
      ),
    );
  return (
    <div className="space-y-1.5 text-sm leading-7" dir="auto">
      {lines.map((l, k) => {
        if (/^#{1,4}\s/.test(l)) return <div key={k} className="pt-1 font-semibold text-ink">{inline(l.replace(/^#+\s/, ''), k)}</div>;
        if (/^\s*[-•*]\s/.test(l)) return <div key={k} className="flex gap-2 ps-2"><span className="text-brand">•</span><span>{inline(l.replace(/^\s*[-•*]\s/, ''), k)}</span></div>;
        if (/^\s*\d+[.)]\s/.test(l)) return <div key={k} className="ps-2">{inline(l, k)}</div>;
        if (!l.trim()) return <div key={k} className="h-1" />;
        return <p key={k}>{inline(l, k)}</p>;
      })}
    </div>
  );
}

export default function Assistant() {
  const { t, lang } = useI18n();
  const { meta } = useApp();
  const convs = useApi('/ai/conversations');
  const [cid, setCid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const { run, busy } = useAction();

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages, sending]);

  const open = async (id) => {
    setCid(id);
    setError(null);
    try {
      const tr = await api.get(`/ai/conversations/${id}`);
      setMessages(tr.messages);
      setActions(tr.actions);
    } catch (e) {
      setError(e);
    }
  };
  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    setSending(true);
    try {
      const r = await api.post('/ai/chat', { conversation_id: cid, message: msg });
      setCid(r.conversation_id);
      const tr = await api.get(`/ai/conversations/${r.conversation_id}`);
      setMessages(tr.messages);
      setActions(tr.actions);
      convs.reload(true);
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };
  const decide = async (a, ok) => {
    const r = await run(a.id, () => (ok ? api.post(`/ai/actions/${a.id}/confirm`, {}, { reason: a.summary }) : api.post(`/ai/actions/${a.id}/reject`, {})), { success: ok ? t(['نُفّذ الإجراء', 'Action exécutée']) : t(['رُفض', 'Refusé']) });
    if (r) open(cid);
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={Bot} title={t('nav.assistant')} subtitle={t(['اسأل عن أي شيء في متجرك: يقرأ الأرقام الحقيقية، يحلل، ويقترح — والتعديلات لا تُنفّذ إلا بموافقتك', 'Posez vos questions : il lit les vrais chiffres, analyse et propose — rien n’est modifié sans votre accord'])} />
      {!meta?.ai_configured && <ErrorBox error={{ code: 'ai_not_configured' }} />}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card pad={false} className="h-fit lg:sticky lg:top-20">
          <div className="border-b border-line p-3">
            <Button
              className="w-full"
              icon={Plus}
              onClick={() => {
                setCid(null);
                setMessages([]);
                setActions([]);
              }}
            >
              {t(['محادثة جديدة', 'Nouvelle conversation'])}
            </Button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-2">
            {(convs.data || []).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => open(c.id)} className={cx('w-full rounded-lg px-2.5 py-2 text-start text-sm hover:bg-raised', cid === c.id && 'bg-brand/10')}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="truncate">{c.title}</span>
                  </div>
                  <div className="ps-5 text-[11px] text-muted">{ago(c.updated_at, lang)}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card pad={false} className="flex min-h-[70vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {!messages.length && (
              <div className="py-8 text-center">
                <Bot className="mx-auto h-10 w-10 text-brand" />
                <p className="mt-3 text-sm text-sub">{t(['جرّب:', 'Essayez :'])}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s[0]} type="button" className="chip bg-raised px-3 py-1.5 text-sm text-ink hover:bg-brand/10" onClick={() => send(t(s))}>
                      {t(s)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, k) => (
              <div key={k} className={cx('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', m.role === 'user' ? 'bg-brand-fill text-brand-on' : 'bg-raised text-brand')}>{m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</span>
                <div className={cx('max-w-[85%] rounded-xl px-4 py-2.5', m.role === 'user' ? 'bg-brand/10' : 'bg-raised')}>
                  {m.text ? <Rich text={m.text} /> : null}
                  {m.tools?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.tools.map((x, i) => (
                        <Badge key={i} icon={Wrench}>
                          {x}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {actions.map((a) => (
              <div key={a.id} className={cx('rounded-xl border p-3', a.status === 'pending' ? 'border-warn/50 bg-warn/5' : 'border-line')}>
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-warn" />
                  <b className="text-sm">{t(['إجراء مقترح', 'Action proposée'])}</b>
                  <Badge>{a.kind}</Badge>
                  <Badge tone={a.status === 'done' ? 'good' : a.status === 'pending' ? 'warn' : a.status === 'failed' ? 'bad' : 'neutral'}>{a.status}</Badge>
                </div>
                <p className="mt-1 text-sm" dir="auto">
                  {a.summary}
                </p>
                {a.status === 'pending' && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy === a.id} onClick={() => decide(a, true)}>
                      {t(['تنفيذ (كلمة المرور الحساسة)', 'Exécuter (mot de passe sensible)'])}
                    </Button>
                    <Button size="sm" icon={XCircle} onClick={() => decide(a, false)}>
                      {t(['رفض', 'Refuser'])}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="h-4 w-4" />
                {t(['يقرأ البيانات ويحلل…', 'Lecture des données et analyse…'])}
              </div>
            )}
            <ErrorBox error={error} />
            <div ref={endRef} />
          </div>
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Textarea
              className="min-h-[44px] flex-1 resize-none"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t(['اكتب سؤالك… (Enter للإرسال)', 'Votre question… (Entrée pour envoyer)'])}
            />
            <Button aria-label={t(['إرسال', 'Envoyer'])} type="submit" variant="primary" icon={Send} disabled={!input.trim() || sending} />
          </form>
        </Card>
      </div>
    </div>
  );
}
