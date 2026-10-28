import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw, Rocket, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useLocalStorage } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useApp } from './ProjectContext.jsx';
import { Button, Card, ErrorBox, Loading, cx, useAction } from './ui.jsx';

/**
 * جاهزية الإطلاق: كل ما يجب أن يعمل قبل صرف أول دينار، سطراً بسطر. لكل بند ما يعنيه وما العمل إن لم يكن جاهزاً.
 * ok جاهز · warn تنبيه · bad يمنع أو يفسد القياس · unknown لا معلومة بعد.
 */
const ORDER = ['shopify', 'products', 'store_pages', 'meta_connected', 'meta_token', 'ad_account', 'pixel_live', 'capi_token', 'capi_events', 'test_code', 'fx', 'visits', 'attribution', 'carriers', 'backup'];

const ITEMS = {
  shopify: { label: ['Shopify مربوط', 'Shopify connecté'], todo: ['الإعدادات ← التكاملات ← Shopify', 'Paramètres → Intégrations → Shopify'], to: '/settings?tab=integrations' },
  products: { label: ['منتج منشور في المتجر', 'Produit publié sur la boutique'], todo: ['انشر منتجاً من محرر المنتج', 'Publiez un produit depuis l’éditeur produit'], to: '/products' },
  store_pages: {
    label: ['صفحات المنتجات تستقبل النقرات (بيكسل ونموذج صحيحان)', 'Pages produit prêtes pour les clics (pixel + formulaire)'],
    todo: ['افتح فحص الرابط في «إطلاق حملة» لترى السبب', 'Voyez la vérification du lien dans « Lancer » pour la cause'],
    to: '/ads?tab=launch',
  },
  meta_connected: { label: ['Meta مربوط (رمز وحساب إعلاني)', 'Meta connecté (jeton + compte pub)'], todo: ['الإعدادات ← التكاملات ← Meta: ضع الرمز ثم «اكتشاف من Meta»', 'Paramètres → Intégrations → Meta : collez le jeton puis « Détecter depuis Meta »'], to: '/settings?tab=integrations' },
  meta_token: {
    label: ['رمز Meta صالح ولا ينتهي قريباً', 'Jeton Meta valide, loin de l’expiration'],
    todo: {
      bad: ['الرمز مات أو انتهى: ضع رمزاً جديداً ثم اضغط «اختبار»', 'Jeton mort ou expiré : collez-en un nouveau puis « Tester »'],
      warn: ['ينتهي قريباً: جدّده (Access Token Debugger ← Extend Access Token) أو أنشئ رمز System User بمدة «Jamais»', 'Bientôt expiré : renouvelez-le (Access Token Debugger → Extend Access Token) ou créez un jeton System User « Jamais »'],
      unknown: ['لم يُفحص بعد: اضغط «اختبار» في بطاقة Meta', 'Pas encore vérifié : « Tester » dans la carte Meta'],
    },
    to: '/settings?tab=integrations',
  },
  ad_account: {
    label: ['الحساب الإعلاني نشط، بوسيلة دفع، وبعيد عن السقف', 'Compte pub actif, moyen de paiement, loin du plafond'],
    todo: ['افتح الحساب في Ads Manager وعالج الحالة أو وسيلة الدفع', 'Ouvrez le compte dans Ads Manager : statut ou moyen de paiement'],
    to: '/ads?tab=health',
  },
  pixel_live: { label: ['البيكسل يستقبل أحداثاً (آخر 48 ساعة)', 'Pixel actif (48 dernières heures)'], todo: ['افتح صفحة منتج بهاتفك ثم أعد الفحص؛ إن بقي صامتاً فالبيكسل غير محمّل', 'Ouvrez une page produit sur votre téléphone puis revérifiez ; s’il reste muet, le pixel n’est pas chargé'] },
  capi_token: {
    label: ['أحداث الـ ERP تُرسل برمز لا ينتهي', 'Événements ERP envoyés avec un jeton permanent'],
    todo: ['ضع «رمز API التحويلات» من Events Manager في بطاقة Meta (يخص البيكسل ولا ينتهي)', 'Collez le « jeton API de conversion » d’Events Manager dans la carte Meta (propre au pixel, permanent)'],
    to: '/settings?tab=integrations',
  },
  capi_events: { label: ['أحداث «أُكّدت» و«سُلّمت» تُرسل إلى Meta', 'Événements « confirmée » et « livrée » envoyés à Meta'], todo: ['فعّلها في بطاقة Meta: تعلّم الخوارزمية من يستلم فعلاً', 'Activez-les dans la carte Meta : l’algorithme apprend qui reçoit vraiment'], to: '/settings?tab=integrations' },
  test_code: { label: ['لا رمز «اختبار الأحداث» مفعّل', 'Aucun code « Tester les événements » actif'], todo: ['امسحه من بطاقة Meta (يتوقف وحده بعد 3 ساعات من حفظه)', 'Videz-le dans la carte Meta (il s’arrête seul 3 h après l’enregistrement)'], to: '/settings?tab=integrations' },
  fx: { label: ['سعر الدولار/اليورو بالدينار مضبوط', 'Taux USD/EUR en DA défini'], todo: ['اضبطه بسعر السوق الموازي من زر الصرف أعلى الصفحة', 'Réglez-le au taux du marché parallèle (bouton en haut de page)'] },
  visits: { label: ['عدّاد الزوار يعمل (زيارة في آخر 24 ساعة)', 'Compteur de visiteurs actif (visite < 24 h)'], todo: ['لا زيارة منذ يوم: راجع «التكامل مع القالب» في صفحات المتجر', 'Aucune visite depuis un jour : voyez « Intégration au thème » dans Pages boutique'], to: '/store-pages' },
  attribution: { label: ['الطلبيات تحمل رابط صفحتها (landing_page)', 'Les commandes portent leur page d’origine (landing_page)'], todo: ['طلبيات تصل بلا رابط الصفحة: نموذج الطلب أو n8n لا يرسله فلا تُنسب الطلبيات للإعلانات', 'Des commandes arrivent sans page d’origine : le formulaire ou n8n ne l’envoie pas, donc pas d’attribution aux pubs'], to: '/store-pages' },
  carriers: { label: ['شركة توصيل مربوطة', 'Transporteur connecté'], todo: ['الإعدادات ← التكاملات ← شركات التوصيل', 'Paramètres → Intégrations → Transporteurs'], to: '/settings?tab=integrations' },
  backup: { label: ['نسخة احتياطية خارج الخادم', 'Sauvegarde hors serveur'], todo: ['الإعدادات ← النظام ← نسخة احتياطية الآن', 'Paramètres → Système → Sauvegarde maintenant'], to: '/settings?tab=system' },
};

// ما لا يراه الـ ERP أصلاً: تذكير يدوي يُؤشَّر عليه
const MANUAL = [
  { key: 'n8n_capi', text: ['n8n: رمز Conversions API صالح. افتح آخر تنفيذ لسير COD: عقدة «Meta Conversions API» يجب أن تُرجع events_received: 1 (إن رجع خطأ 100/33 فالرمز في Credentials ← access_token ميت)', 'n8n : le jeton Conversions API est valide. Dernière exécution du flux COD : le nœud « Meta Conversions API » doit renvoyer events_received: 1 (erreur 100/33 = jeton mort dans Credentials → access_token)'] },
  { key: 'app_live', text: ['تطبيق Meta في وضع «Live» (developers.facebook.com ← التطبيق ← Publier). في وضع التطوير ترفض Meta إنشاء الإعلانات', 'L’app Meta est en mode « Live » (developers.facebook.com → app → Publier). En mode développement, Meta refuse de créer les annonces'] },
  { key: 'first_paused', text: ['أول حملة تُنشأ متوقفة وتمرّ مراجعة Meta قبل أي تفعيل، بميزانيتك أنت', 'La première campagne est créée en pause et passe la revue Meta avant toute activation, avec votre budget'] },
];

const PAGE_PROBLEM = {
  pixel_missing: ['لا بيكسل Meta في الصفحة', 'Aucun pixel Meta sur la page'],
  pixel_mismatch: ['بيكسل الصفحة ليس بيكسل المشروع', 'Le pixel de la page n’est pas celui du projet'],
  form_missing: ['لا نموذج طلب في الصفحة', 'Aucun formulaire de commande'],
  not_found: ['الصفحة غير موجودة (404)', 'Page introuvable (404)'],
  http_error: ['الصفحة لا تفتح', 'La page ne s’ouvre pas'],
  sold_out: ['المنتج نفد مخزونه', 'Produit en rupture'],
  redirect: ['الرابط يحوّل إلى صفحة أخرى', 'Le lien redirige'],
  redirect_other_domain: ['الرابط يمرّ بنطاق آخر', 'Le lien passe par un autre domaine'],
  canonical_mismatch: ['الرابط الأساسي (canonical) مختلف', 'URL canonique différente'],
  not_store_domain: ['الصفحة ليست على نطاق المتجر', 'Page hors du domaine de la boutique'],
  slow: ['الصفحة بطيئة', 'Page lente'],
  redirect_loop: ['تحويلات لا تنتهي', 'Redirections sans fin'],
  redirect_unsafe: ['تحويل إلى عنوان غير آمن', 'Redirection non sûre'],
};

const ICON = {
  ok: <CheckCircle2 className="h-4 w-4 shrink-0 text-good" aria-hidden />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />,
  bad: <XCircle className="h-4 w-4 shrink-0 text-bad" aria-hidden />,
  unknown: <span className="h-4 w-4 shrink-0 rounded-full border border-line" aria-hidden />,
};
const STATE_WORD = { ok: ['جاهز', 'Prêt'], warn: ['تنبيه', 'Attention'], bad: ['يمنع', 'Bloquant'], unknown: ['لم يُفحص', 'Non vérifié'] };

export default function Readiness() {
  const { t } = useI18n();
  const { project } = useApp();
  const { data, error, loading, reload } = useApi('/ads/readiness');
  const { run, busy } = useAction();
  const [manual, setManual] = useLocalStorage(`erp.ready.manual.${project}`, {});
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const by = Object.fromEntries(data.items.map((i) => [i.key, i]));
  const { counts } = data;
  const tone = counts.bad ? 'bad' : counts.warn ? 'warn' : 'good';
  const headline = counts.bad
    ? t(['غير جاهز: {n} بند يمنع أو يفسد القياس', 'Pas prêt : {n} point(s) bloquant(s)'], { n: counts.bad })
    : counts.warn
      ? t(['جاهز مع {n} تنبيه', 'Prêt avec {n} alerte(s)'], { n: counts.warn })
      : counts.unknown
        ? t(['جاهز، و{n} بند لم يُفحص بعد', 'Prêt, {n} point(s) pas encore vérifié(s)'], { n: counts.unknown })
        : t(['جاهز للإطلاق', 'Prêt à lancer']);
  return (
    <Card
      title={t(['جاهزية الإطلاق', 'Prêt à lancer'])}
      icon={Rocket}
      actions={
        <Button size="sm" icon={RefreshCw} loading={busy === 'ready'} onClick={() => run('ready', () => api.get('/ads/readiness?fresh=1')).then((r) => r && reload(true))}>
          {t(['إعادة الفحص', 'Revérifier'])}
        </Button>
      }
    >
      <p className={cx('mb-3 text-sm font-semibold', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-good')} role="status">
        {headline}
      </p>
      <ul className="space-y-2.5 text-sm">
        {ORDER.filter((k) => by[k]).map((k) => {
          const it = by[k];
          const def = ITEMS[k];
          const todo = typeof def.todo === 'object' && !Array.isArray(def.todo) ? def.todo[it.state] || def.todo.warn || def.todo.bad : def.todo;
          const detail = [
            k === 'meta_token' && it.value != null ? t(['بعد {n} يوماً', 'dans {n} j'], { n: it.value }) : null,
            k === 'products' && it.value ? String(it.value) : null,
            k === 'attribution' && it.value ? String(it.value) : null,
            k === 'ad_account' && it.value ? String(it.value) : null,
            k === 'store_pages' && it.state !== 'ok' && it.value ? it.value : null,
          ].filter(Boolean);
          return (
            <li key={k} className="flex items-start gap-2">
              <span className="mt-0.5">{ICON[it.state]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span>{t(def.label)}</span>
                  {detail.length > 0 && <span className="text-xs text-muted">{detail.join(' · ')}</span>}
                  <span className="sr-only">{t(STATE_WORD[it.state])}</span>
                </div>
                {it.state !== 'ok' && it.state !== 'unknown' && (
                  <p className="mt-0.5 text-xs text-sub">
                    {todo ? t(todo) : ''}
                    {k === 'store_pages' && it.params?.problems?.length ? ` — ${it.params.problems.map((c) => t(PAGE_PROBLEM[c] || [c, c])).join('، ')}` : ''}
                    {def.to && (
                      <>
                        {' '}
                        <Link className="underline" to={def.to}>
                          {t(['فتح', 'Ouvrir'])}
                        </Link>
                      </>
                    )}
                  </p>
                )}
                {it.state === 'unknown' && todo && <p className="mt-0.5 text-xs text-muted">{t(typeof def.todo === 'object' && !Array.isArray(def.todo) ? def.todo.unknown || ['لا معلومة بعد', 'Pas encore d’information'] : ['لا معلومة بعد', 'Pas encore d’information'])}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-xs font-semibold text-sub">{t(['لا يراه الـ ERP: تحقق منه بنفسك وأشّر', 'L’ERP ne le voit pas : vérifiez-le et cochez'])}</p>
        <ul className="space-y-2 text-xs">
          {MANUAL.map((m) => (
            <li key={m.key}>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={Boolean(manual[m.key])} onChange={(e) => setManual({ ...manual, [m.key]: e.target.checked })} />
                <span className={cx(manual[m.key] && 'text-muted line-through')}>{t(m.text)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
