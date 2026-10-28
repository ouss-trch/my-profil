import { useEffect, useState } from 'react';
import { RefreshCw, Truck } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { da, dateOnly, n0 } from '../lib/format.js';
import { useApp } from './ProjectContext.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, useAction } from './ui.jsx';

/** اقتراح من الطلبيات المسلّمة: «من 1 إلى 3 أيام حسب الولاية» (التاجر يؤكده أو يعدّله) */
const suggestion = (m) => {
  if (!m?.enough) return '';
  const lo = Math.max(1, Math.round(m.median));
  const hi = Math.max(lo, Math.ceil(m.p80));
  return lo === hi ? `خلال ${lo} أيام تقريباً حسب الولاية` : `من ${lo} إلى ${hi} أيام حسب الولاية`;
};

/** أسعار التوصيل وسياسات المتجر كما يراها الزبون: مصدرها المتجر، ويستعملها كاتب صفحات الهبوط */
export default function DeliveryCard({ onChange }) {
  const { t, lang } = useI18n();
  const { isAll } = useApp();
  const { data, error, loading, reload, setData } = useApi('/pages/delivery', {
    skip: isAll,
  });
  const { run, busy } = useAction();
  const [time, setTime] = useState('');
  useEffect(() => setTime(data?.delivery_time || ''), [data?.delivery_time]);
  if (isAll) return null;

  const done = (r) => {
    if (r) {
      setData(r);
      onChange?.();
    }
  };
  const importNow = () =>
    run('import', () => api.post('/pages/delivery/import', {}), {
      success: t(['تم تحديث الأسعار والسياسات من المتجر', 'Tarifs et politiques mis à jour']),
    }).then(done);
  const s = data?.summary;
  const m = data?.measured;
  const sug = suggestion(m);
  const refresh = (
    <Button icon={RefreshCw} loading={busy === 'import'} onClick={importNow}>
      {t(['تحديث من المتجر', 'Mettre à jour depuis la boutique'])}
    </Button>
  );

  return (
    <Card
      icon={Truck}
      title={t(['التوصيل والسياسات', 'Livraison et politiques'])}
      subtitle={t([
        'من متجرك نفسه: جدول أسعار التوصيل وصفحتا الشحن والاسترجاع. تُكتب بها صفحات الهبوط دون تخمين.',
        'Depuis votre boutique : grille de livraison et politiques. Les landing pages s’en servent, sans rien inventer.',
      ])}
      actions={data?.imported_at ? refresh : null}
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.imported_at ? (
        <Empty icon={Truck} title={t(['لم تُستورد بعد', 'Pas encore importées'])} action={refresh}>
          {t([
            'يقرأ الـ ERP أسعار المكتب والمنزل لكل ولاية من إعدادات القالب (نفس مصدر نموذج الطلب)، والمعاينة والاسترجاع من صفحات السياسات.',
            'L’ERP lit les tarifs bureau/domicile du thème (même source que le formulaire) et les politiques de la boutique.',
          ])}
        </Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="good">{t([`التوصيل إلى جميع الولايات (${s.served})`, `Livraison dans toutes les wilayas (${s.served})`])}</Badge>
            {s.desk && (
              <Badge>
                {t(['المكتب من', 'Bureau dès'])} {da(s.desk.min)}
              </Badge>
            )}
            {s.home && (
              <Badge>
                {t(['المنزل من', 'Domicile dès'])} {da(s.home.min)}
              </Badge>
            )}
            {data.carriers && <Badge>{data.carriers}</Badge>}
            <span className="text-xs text-muted">
              {t(data.source === 'theme' ? ['من إعدادات القالب', 'depuis le thème'] : ['من صفحة الأسعار', 'depuis la page tarifs'])} · {dateOnly(data.imported_at, lang)}
            </span>
          </div>
          {s.unpriced.length > 0 && s.unpriced.length < 30 && (
            <p className="text-xs leading-6 text-muted">
              {t(
                [`نموذج الطلب في المتجر يأخذ أسعاره من جدول القالب، وهذه الولايات بلا سعر فيه فيرفضها النموذج: ${s.unpriced.join('، ')}. ضع لها سعراً في إعدادات القالب (جدول التوصيل) لتُقبل طلباتها.`, `Le formulaire de la boutique lit ses tarifs dans la grille du thème ; ces wilayas n’y ont pas de prix et il les refuse : ${s.unpriced.join(', ')}. Ajoutez-leur un tarif dans les réglages du thème (grille de livraison).`],
              )}
            </p>
          )}

          <Field
            label={t(['مدة التوصيل التي تلتزم بها أمام الزبون', 'Délai de livraison annoncé au client'])}
            hint={t([
              'تُكتب في صفحات الهبوط كما هي. إن تركتها فارغة تقول الصفحة إنها تختلف حسب الولاية وتُؤكَّد عند الاتصال، كما في سياسة متجرك.',
              'Repris tel quel. Vide : « selon la wilaya, confirmé à l’appel », comme dans votre politique.',
            ])}
          >
            {(id) => (
              <div className="flex flex-wrap gap-2">
                <Input
                  id={id}
                  className="min-w-0 flex-1"
                  value={time}
                  maxLength={200}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder={sug || t(['مثال: من 24 إلى 72 ساعة حسب الولاية', 'Ex. : 24 à 72 h selon la wilaya'])}
                />
                <Button
                  loading={busy === 'time'}
                  disabled={time.trim() === (data.delivery_time || '')}
                  onClick={() => run('time', () => api.patch('/pages/delivery', { delivery_time: time }), { success: t(['حُفظت مدة التوصيل', 'Délai enregistré']) }).then(done)}
                >
                  {t('c.save')}
                </Button>
              </div>
            )}
          </Field>
          {m?.enough ? (
            <p className="text-xs leading-6 text-sub">
              {t([
                `من طلبياتك المسلّمة (${n0(m.count)} طرد، آخر ${m.days} يوماً): نصف الطرود وصلت خلال ${m.median} يوم، و80% خلال ${m.p80} يوم.`,
                `Vos colis livrés (${n0(m.count)}, ${m.days} j) : médiane ${m.median} j, 80 % en ${m.p80} j.`,
              ])}{' '}
              {sug && sug !== time && (
                <button type="button" className="font-semibold text-brand underline" onClick={() => setTime(sug)}>
                  {t(['استعمل: ', 'Utiliser : '])}
                  {sug}
                </button>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted">{t(['حين تتجاوز طلبياتك المسلّمة 10 طرود، يقترح الـ ERP المدة المقاسة منها.', 'Au-delà de 10 colis livrés, l’ERP proposera le délai mesuré.'])}</p>
          )}

          <details className="rounded-lg border border-line">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t([`الأسعار حسب الولاية (${data.rates.length})`, `Tarifs par wilaya (${data.rates.length})`])}</summary>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-xs text-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-start font-medium">{t(['الولاية', 'Wilaya'])}</th>
                    <th className="px-3 py-1.5 text-end font-medium">{t(['المكتب', 'Bureau'])}</th>
                    <th className="px-3 py-1.5 text-end font-medium">{t(['المنزل', 'Domicile'])}</th>
                    {m?.enough && <th className="px-3 py-1.5 text-end font-medium">{t(['المدة المقاسة', 'Délai mesuré'])}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rates.map((r) => (
                    <tr key={r.code}>
                      <td className="px-3 py-1.5">
                        <span className="ltr me-1.5 text-xs text-muted">{String(r.code).padStart(2, '0')}</span>
                        {r.name}
                      </td>
                      <td className="px-3 py-1.5 text-end">{r.desk === null ? <span className="text-muted">—</span> : da(r.desk)}</td>
                      <td className="px-3 py-1.5 text-end">{r.home === null ? <span className="text-muted">—</span> : da(r.home)}</td>
                      {m?.enough && <td className="px-3 py-1.5 text-end text-sub">{m.by_wilaya?.[r.code] ? t([`${m.by_wilaya[r.code].median} يوم`, `${m.by_wilaya[r.code].median} j`]) : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {['shipping', 'refund'].map(
            (k) =>
              data.policies[k] && (
                <details key={k} className="rounded-lg border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    {t(k === 'shipping' ? ['سياسة الشحن', 'Politique d’expédition'] : ['سياسة الاسترجاع والمعاينة', 'Retours et inspection'])}
                  </summary>
                  <p dir="rtl" lang="ar" className="whitespace-pre-line px-3 pb-3 text-xs leading-6 text-sub">
                    {data.policies[k]}
                  </p>
                </details>
              ),
          )}
        </div>
      )}
    </Card>
  );
}
