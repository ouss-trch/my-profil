import { Lightbulb, PhoneOff, Truck } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { Badge, Bar, Card, cx } from './ui.jsx';

/** تقييم الزبون كما يحسبه الخادم (server/services/customers.js): المستوى، احتمال التسليم، الأسباب، اقتراح للمؤكِّد */
export const LEVELS = {
  high: { tone: 'bad', label: ['خطر', 'Risqué'], box: 'border-bad/40 bg-bad/5' },
  medium: { tone: 'warn', label: ['متوسط', 'Moyen'], box: 'border-warn/40 bg-warn/5' },
  low: { tone: 'neutral', label: ['عادي', 'Normal'], box: 'border-line bg-raised' },
  trusted: { tone: 'good', label: ['موثوق', 'Fiable'], box: 'border-good/40 bg-good/5' },
  new: { tone: 'info', label: ['جديد', 'Nouveau'], box: 'border-line bg-raised' },
};
export const LEVEL_KEYS = ['high', 'medium', 'low', 'trusted', 'new'];

const REASONS = {
  blacklisted: ['في القائمة السوداء', 'Sur liste noire'],
  delivered: ['استلم ×{n}', 'Livré ×{n}'],
  returned: ['أرجع الطرد ×{n}', 'Retour ×{n}'],
  refused: ['رفض الاستلام ×{n}', 'Refus ×{n}'],
  fake: ['طلبية مزيفة ×{n}', 'Fausse commande ×{n}'],
  no_answer: ['لا يرد عند التأكيد ×{n}', 'Sans réponse à la confirmation ×{n}'],
  unreached: ['أُلغيت لأنه لم يرد ×{n}', 'Annulée, jamais joint ×{n}'],
  delivery_failed: ['فشل التوصيل ×{n}', 'Échec de livraison ×{n}'],
  courier_no_answer: ['لم يرد على الموزع ×{n}', 'Injoignable pour le livreur ×{n}'],
  changed_mind: ['تراجع بعد التأكيد ×{n}', 'Annule après confirmation ×{n}'],
  duplicates: ['{n} طلبيات مفتوحة', '{n} commandes ouvertes'],
};
const BAD = new Set(['blacklisted', 'returned', 'refused', 'fake']);

const ADVICE = {
  deposit_or_desk: ['أرجع أو رفض طروداً من قبل: أكّد بوضوح، واقترح التوصيل إلى المكتب (Stop Desk) أو عربوناً للطلبيات الغالية.', 'A déjà retourné ou refusé : confirmez clairement, proposez le Stop Desk ou un acompte pour les commandes chères.'],
  confirm_twice: ['أكّد جيداً: العنوان، رقم ثانٍ، وموعد الاستلام، واتصل به قبل الشحن.', 'Confirmez bien : adresse, 2e numéro, créneau, et rappelez avant l’expédition.'],
  fake_before: ['سجّل طلبية مزيفة من قبل: لا تشحن قبل تأكيد صريح بالصوت، واقترح المكتب أو عربوناً.', 'A déjà passé une fausse commande : n’expédiez qu’après une confirmation claire de vive voix ; proposez le Stop Desk ou un acompte.'],
  fast_track: ['زبون موثوق: أكّد بسرعة واشحن.', 'Client fiable : confirmez vite et expédiez.'],
  blacklisted: ['رقم محظور: لا تشحن قبل مراجعة المدير.', 'Numéro bloqué : n’expédiez pas sans l’accord du gérant.'],
};

export function RiskBadge({ level, blacklisted }) {
  const { t } = useI18n();
  const l = LEVELS[level] || LEVELS.new;
  return <Badge tone={l.tone}>{blacklisted ? t(['محظور', 'Bloqué']) : t(l.label)}</Badge>;
}

export function ReasonChips({ reasons = [], skip = [], className }) {
  const { t } = useI18n();
  const list = reasons.filter((r) => REASONS[r.code] && !skip.includes(r.code));
  if (!list.length) return null;
  return (
    <div className={cx('flex flex-wrap gap-1', className)}>
      {list.map((r) => (
        <Badge key={r.code} tone={r.good ? 'good' : BAD.has(r.code) ? 'bad' : 'warn'} className="text-[11px]">
          {t(REASONS[r.code], { n: r.n })}
        </Badge>
      ))}
    </div>
  );
}

export function Advice({ code, className }) {
  const { t } = useI18n();
  if (!ADVICE[code]) return null;
  return (
    <p className={cx('flex items-start gap-1.5 text-xs font-medium text-ink', className)}>
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
      <span>{t(ADVICE[code])}</span>
    </p>
  );
}

/** لون نسبة التسليم المتوقعة حسب المستوى */
export const pTone = (level) => (level === 'high' ? 'text-bad' : level === 'medium' ? 'text-warn' : level === 'trusted' ? 'text-good' : 'text-ink');

const CALL_LABELS = [
  ['أُكّد من أول اتصال', 'Confirmé au 1er appel'],
  ['لم يرد مرة', '1 appel sans réponse'],
  ['لم يرد مرتين', '2 appels sans réponse'],
  ['لم يرد 3 مرات أو أكثر', '3 appels sans réponse ou plus'],
];
const FAIL_LABELS = [
  ['دون محاولة فاشلة', 'Sans échec de livraison'],
  ['محاولة توصيل فاشلة', '1 échec de livraison'],
  ['محاولتان فاشلتان أو أكثر', '2 échecs ou plus'],
];

function LessonRows({ rows, labels, icon: Icon, title }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-sub">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {rows.map((r, k) => {
        const rate = Math.round(r.rate * 100);
        const n = r.delivered + r.returned;
        return (
          <div key={k} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink">{t(labels[k])}</span>
              <span className="num shrink-0">
                <b className={rate >= 75 ? 'text-good' : rate >= 55 ? 'text-warn' : 'text-bad'}>{rate}%</b>
                <span className="text-muted"> · {t(['{n} طلبية', '{n} cmd'], { n })}</span>
              </span>
            </div>
            <Bar value={rate} tone={rate >= 75 ? 'good' : rate >= 55 ? 'warn' : 'bad'} />
          </div>
        );
      })}
    </div>
  );
}

/** ماذا تقول بياناتك: نسبة التسليم حسب «لا يرد» قبل التأكيد وحسب محاولات التوصيل الفاشلة */
export function CallLessons({ lessons }) {
  const { t } = useI18n();
  if (!lessons) return null;
  return (
    <Card title={t(['ماذا تقول بياناتك', 'Ce que disent vos données'])} subtitle={t(['نسبة التسليم الفعلية في متجرك، من {n} طلبية مسلّمة أو مرتجعة', 'Taux de livraison réel de votre boutique, sur {n} commandes livrées ou retournées'], { n: lessons.closed })}>
      <div className="grid gap-5 sm:grid-cols-2">
        <LessonRows rows={lessons.byCalls} labels={CALL_LABELS} icon={PhoneOff} title={t(['حسب «لا يرد» قبل التأكيد', 'Selon les appels sans réponse'])} />
        <LessonRows rows={lessons.byFails} labels={FAIL_LABELS} icon={Truck} title={t(['حسب محاولات التوصيل', 'Selon les tentatives de livraison'])} />
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted">
        {lessons.closed < 30
          ? t(['بياناتك قليلة بعد: النسب تبدأ من قيم شائعة وتتعدّل وحدها مع كل طلبية تُسلَّم أو تُرجَع.', 'Encore peu de données : les taux partent de valeurs courantes et s’ajustent seuls à chaque commande livrée ou retournée.'])
          : t(['من لا يرد عند التأكيد غالباً لا يرد على الموزع أيضاً. بهذه النسب يُقدَّر احتمال التسليم لكل زبون، ثم يُعدَّل بتاريخه هو (استلم، أرجع، رفض، مزيفة).', 'Qui ne répond pas à la confirmation répond rarement au livreur. Ces taux estiment la livraison de chaque client, puis son propre historique l’ajuste.'])}
      </p>
    </Card>
  );
}
