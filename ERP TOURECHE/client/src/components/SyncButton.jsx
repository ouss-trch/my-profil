import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, MinusCircle, RefreshCw, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { api } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { Button, IconButton, Modal, cx, useToast } from './ui.jsx';

const STEP = {
  products: ['منتجات Shopify', 'Produits Shopify'],
  orders: ['طلبيات Shopify', 'Commandes Shopify'],
  sheet: ['جدول Google', 'Google Sheets'],
  pages: ['صفحات المتجر', 'Pages de la boutique'],
  tracking: ['تتبع الطرود', 'Suivi des colis'],
  tariffs: ['أسعار التوصيل', 'Tarifs de livraison'],
  returns: ['المرتجعات نحو مخزون Shopify', 'Retours vers le stock Shopify'],
  campaigns: ['حملات Meta', 'Campagnes Meta'],
  spend: ['إنفاق Meta (7 أيام)', 'Dépenses Meta (7 j)'],
};
const COUNT = {
  created: ['جديد', 'nouveaux'],
  updated: ['محدّث', 'mis à jour'],
  changed: ['تغيّر', 'changés'],
  checked: ['فُحص', 'vérifiés'],
  synced: ['متزامن', 'synchronisés'],
  campaigns: ['حملة', 'campagnes'],
  rows: ['سطر', 'lignes'],
  done: ['أُرسل', 'envoyés'],
};

// «shopify: network_unreachable» ← رسالة مفهومة؛ النص الأصلي يبقى في title للتشخيص
const friendly = (error, err) => {
  const raw = String(error || '');
  const code = raw.replace(/^[a-z_]+:\s*/i, '').trim();
  return raw.startsWith('returns_failed:') ? err({ code: raw }) : err({ code }) || raw;
};

function detail(step, t, err) {
  if (step.status === 'error') return friendly(step.error, err);
  if (step.status === 'skipped') return t(['تعمل بالفعل', 'Déjà en cours']);
  const r = step.result || {};
  const parts = Object.entries(COUNT)
    .filter(([k]) => typeof r[k] === 'number' && (r[k] > 0 || ['created', 'changed'].includes(k)))
    .map(([k, l]) => `${r[k]} ${t(l)}`);
  return parts.join(' · ');
}

const ICON = {
  pending: [Circle, 'text-muted'],
  running: [Loader2, 'animate-spin text-brand'],
  ok: [CheckCircle2, 'text-good'],
  skipped: [MinusCircle, 'text-muted'],
  error: [XCircle, 'text-bad'],
};

/**
 * زر المزامنة في الشريط العلوي: مزامنة كاملة (منتجات، طلبيات، صفحات، تتبع، مرتجعات، Meta) تعمل في الخادم،
 * ونافذة تعرض تقدّمها. يمكن إغلاق النافذة والمزامنة مستمرة؛ الأيقونة تدور حتى تنتهي.
 */
export default function SyncButton() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const running = Boolean(s?.running);

  const stop = () => {
    clearInterval(timer.current);
    timer.current = null;
  };
  const finish = (state) => {
    stop();
    const errors = state.steps.filter((x) => x.status === 'error').length;
    const created = state.steps.find((x) => x.key === 'orders')?.result?.created || 0;
    if (errors) toast.error(t([`انتهت المزامنة مع ${errors} خطأ`, `Synchro terminée avec ${errors} erreur(s)`]));
    else toast.ok(created ? t([`تمت المزامنة: ${created} طلبية جديدة`, `Synchronisé : ${created} nouvelle(s) commande(s)`]) : t(['تمت المزامنة', 'Synchronisé']));
    window.dispatchEvent(new Event('erp:refresh'));
  };
  const poll = () => {
    if (timer.current) return;
    timer.current = setInterval(async () => {
      try {
        const state = await api.get('/system/sync');
        setS(state);
        if (state && !state.running) finish(state);
      } catch {
        /* انقطاع مؤقت: نعيد المحاولة في الدورة التالية */
      }
    }, 1500);
  };
  // مزامنة بدأت قبل فتح الصفحة (أو من جهاز آخر): الأيقونة تدور حتى تنتهي
  useEffect(() => {
    api
      .get('/system/sync')
      .then((state) => {
        if (state?.running) {
          setS(state);
          poll();
        }
      })
      .catch(() => {});
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSync = async () => {
    setOpen(true);
    try {
      const state = await api.post('/system/sync', {});
      setS(state);
      if (state.running) poll();
      else finish(state);
    } catch (e) {
      toast.error(e.code === 'project_required' ? t('err.project_required') : e.code || 'error');
    }
  };

  const projects = [...new Set((s?.steps || []).map((x) => x.project))];
  return (
    <>
      <IconButton icon={RefreshCw} label={t('c.sync')} onClick={() => (running ? setOpen(true) : startSync())} className={running ? 'animate-spin' : ''} />
      {open && (
        <Modal
          open
          size="sm"
          icon={RefreshCw}
          onClose={() => setOpen(false)}
          title={t(['المزامنة الكاملة', 'Synchronisation complète'])}
          footer={
            <>
              <span className="me-auto text-xs text-muted">
                {running ? t(['تعمل في الخلفية: يمكنك إغلاق النافذة', 'Tourne en arrière-plan : vous pouvez fermer']) : s?.finished_at ? `${t(['انتهت', 'Terminée'])} ${ago(s.finished_at, lang)}` : ''}
              </span>
              {!running && s && (
                <Button icon={RefreshCw} onClick={startSync}>
                  {t(['مزامنة مرة أخرى', 'Relancer'])}
                </Button>
              )}
            </>
          }
        >
          {!s ? (
            <p className="text-sm text-sub">{t(['تبدأ المزامنة…', 'Démarrage…'])}</p>
          ) : !s.steps.length ? (
            <p className="text-sm text-sub">
              {t(['لا شيء للمزامنة بعد: اربط Shopify أو شركة توصيل أو Meta من ', 'Rien à synchroniser : connectez Shopify, un transporteur ou Meta dans '])}
              <Link className="link" to="/settings?tab=integrations" onClick={() => setOpen(false)}>
                {t(['الإعدادات', 'Paramètres'])}
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => (
                <div key={p}>
                  {projects.length > 1 && <div className="mb-1 text-xs font-semibold text-sub">{p}</div>}
                  <ul className="space-y-1.5">
                    {s.steps
                      .filter((x) => x.project === p)
                      .map((x) => {
                        const [Icon, cls] = ICON[x.status] || ICON.pending;
                        const d = detail(x, t, err);
                        return (
                          <li key={`${x.project_id}-${x.key}`} className="flex items-start gap-2 text-sm">
                            <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', cls)} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span>{t(STEP[x.key] || [x.key, x.key])}</span>
                                {x.ms !== undefined && <span className="num shrink-0 text-xs text-muted">{(x.ms / 1000).toFixed(1)}s</span>}
                              </div>
                              {d && (
                                <div className={cx('text-xs', x.status === 'error' ? 'break-words text-bad' : 'text-muted')} title={x.status === 'error' ? x.error : undefined}>
                                  {d}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
