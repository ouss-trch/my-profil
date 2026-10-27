import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, EyeOff, FileText, Globe, Home, LayoutTemplate, Package, Rows3 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { ago, n0, pct } from '../lib/format.js';
import { BarList, TrendChart } from './charts.jsx';
import { Badge, Card, Empty, ErrorBox, Loading, Segmented, Stat } from './ui.jsx';

/** هل العدّاد يعمل فعلاً؟ آخر زيارة وصلت إلى الـ ERP وعدد زوار آخر 24 ساعة */
export function TrackingBadge({ health }) {
  const { t, lang } = useI18n();
  if (!health) return null;
  if (!health.last_visit_at) return <Badge tone="warn">{t(['لم تصل أي زيارة بعد', 'Aucune visite reçue'])}</Badge>;
  const fresh = Date.now() - Date.parse(health.last_visit_at) < 86400e3;
  return (
    <Badge tone={fresh ? 'good' : 'warn'}>
      {t(['آخر زيارة', 'Dernière visite'])} {ago(health.last_visit_at, lang)} · {n0(health.visitors_24h)} {t(['زائر في 24 ساعة', 'visiteurs / 24 h'])}
    </Badge>
  );
}

const KINDS = {
  landing: { icon: LayoutTemplate, label: ['صفحة هبوط', 'Landing'] },
  template: { icon: LayoutTemplate, label: ['قالب', 'Modèle'] },
  product: { icon: Package, label: ['صفحة المنتج', 'Fiche produit'] },
  home: { icon: Home, label: ['الرئيسية', 'Accueil'] },
  collection: { icon: Rows3, label: ['مجموعة', 'Collection'] },
  page: { icon: FileText, label: ['صفحة', 'Page'] },
  other: { icon: Globe, label: ['أخرى', 'Autre'] },
};

const SOURCES = {
  meta: ['إعلانات Meta', 'Pubs Meta'],
  google: ['Google Ads', 'Google Ads'],
  tiktok: ['TikTok Ads', 'TikTok Ads'],
  campaign: ['حملات أخرى (utm)', 'Autres campagnes (utm)'],
  social: ['فيسبوك/إنستغرام دون إعلان', 'Réseaux sociaux (organique)'],
  search: ['محركات البحث', 'Moteurs de recherche'],
  internal: ['تنقّل داخل المتجر', 'Navigation interne'],
  direct: ['مباشر (رابط محفوظ، واتساب…)', 'Direct (favori, WhatsApp…)'],
  other: ['مواقع أخرى', 'Autres sites'],
};

/**
 * الزوار والتحويل لكل صفحة من عدّاد المتجر: من زار، من بدأ النموذج، من طلب، ومن استلم.
 * التحويل = طلبيات الصفحة ÷ زوارها الفريدين في الفترة.
 */
export default function TrafficCard() {
  const { t } = useI18n();
  const [days, setDays] = useState('7');
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useApi(`/pages/traffic?days=${days}`);
  const pages = (data?.pages || []).filter((p) => p.visitors || p.orders);
  const shown = all ? pages : pages.slice(0, 8);
  return (
    <Card
      icon={Activity}
      title={t(['الزوار والتحويل لكل صفحة', 'Visiteurs et conversion par page'])}
      subtitle={t(['عدّاد مخفي في كل صفحات المتجر. الطلبية تُنسب للصفحة التي أُرسل منها النموذج.', 'Compteur invisible sur toutes les pages. Chaque commande compte pour la page d’où elle est partie.'])}
      actions={
        <Segmented
          size="sm"
          value={days}
          onChange={setDays}
          options={[
            { value: '1', label: t(['اليوم', 'Aujourd’hui']) },
            { value: '7', label: t(['7 أيام', '7 j']) },
            { value: '30', label: t(['30 يوماً', '30 j']) },
          ]}
        />
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TrackingBadge health={data.health} />
            {data.base && (
              <a className="link inline-flex items-center gap-1 text-xs" href={`${data.base}/?erp_me=1`} target="_blank" rel="noreferrer" title={t(['افتح هذا الرابط مرة واحدة على كل هاتف أو حاسوب تستعمله: زياراتك لا تُعدّ بعدها', 'Ouvrez ce lien une fois sur chaque appareil que vous utilisez : vos visites ne comptent plus'])}>
                <EyeOff className="h-3.5 w-3.5" />
                {t(['لا تعدّ زياراتي من هذا الجهاز', 'Ne pas compter cet appareil'])}
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t(['زوار فريدون', 'Visiteurs uniques'])} value={n0(data.totals.visitors)} hint={`${t(['من الإعلانات', 'via pubs'])}: ${n0(data.totals.from_ad)}`} />
            <Stat label={t(['بدأوا نموذج الطلب', 'Ont commencé le formulaire'])} value={n0(data.totals.form)} hint={pct(data.totals.form_rate, 1)} />
            <Stat label={t('c.orders')} value={n0(data.totals.orders)} hint={`${t(['مؤكدة', 'confirmées'])}: ${n0(data.totals.confirmed)}`} />
            <Stat label={t(['التحويل', 'Conversion'])} value={pct(data.totals.conversion, 2)} hint={t(['طلبيات ÷ زوار', 'commandes ÷ visiteurs'])} />
          </div>
          {!pages.length ? (
            <Empty icon={Activity} title={t(['لا زيارات في هذه الفترة بعد', 'Pas encore de visites sur la période'])}>
              {t(['الأرقام تبدأ من أول زيارة بعد تثبيت عدّاد الزوار (اختبار الصفحات ← «تثبيت على القالب»).', 'Les chiffres démarrent à la première visite après l’installation du compteur (Tests A/B → « Installer sur le thème »).'])}
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t(['الصفحة', 'Page'])}</th>
                    <th className="text-end">{t(['زوار', 'Visiteurs'])}</th>
                    <th className="text-end">{t(['بدأوا النموذج', 'Formulaire'])}</th>
                    <th className="text-end">{t('c.orders')}</th>
                    <th className="text-end">{t(['التحويل', 'Conversion'])}</th>
                    <th className="text-end">{t(['مسلّمة', 'Livrées'])}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const K = KINDS[p.kind] || KINDS.other;
                    const name = p.label || t(K.label);
                    return (
                      <tr key={`${p.project_id}:${p.key}`}>
                        <td className="min-w-[13rem]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.product_id ? (
                              <Link className="font-medium hover:underline" to={`/products/${p.product_id}`} dir="auto">
                                {name}
                              </Link>
                            ) : (
                              <span className="font-medium" dir="auto">
                                {name}
                              </span>
                            )}
                            {p.label && <Badge icon={K.icon}>{t(K.label)}</Badge>}
                          </div>
                          {p.sub && <div className="text-xs text-muted" dir="auto">{p.sub}</div>}
                          <div className="ltr max-w-xs truncate text-[11px] text-muted">{p.key}</div>
                        </td>
                        <td className="num text-end">{n0(p.visitors)}</td>
                        <td className="num text-end">
                          {n0(p.form)}
                          {p.form_rate !== null && <span className="text-xs text-muted"> · {pct(p.form_rate)}</span>}
                        </td>
                        <td className="num text-end">{n0(p.orders)}</td>
                        <td className="num text-end font-semibold">{pct(p.conversion, 2)}</td>
                        <td className="num text-end">
                          {n0(p.delivered)}
                          {p.delivery_rate !== null && <span className="text-xs text-muted"> · {pct(p.delivery_rate)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pages.length > 8 && (
                <button type="button" className="link w-full py-2 text-center text-xs" onClick={() => setAll(!all)}>
                  {all ? t(['عرض أقل', 'Voir moins']) : t([`عرض كل الصفحات (${pages.length})`, `Voir toutes les pages (${pages.length})`])}
                </button>
              )}
            </div>
          )}
          {pages.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold text-sub">{t(['من أين جاء الزوار', 'D’où viennent les visiteurs'])}</div>
                <BarList rows={(data.sources || []).map((s) => ({ key: s.source, label: t(SOURCES[s.source] || [s.source, s.source]), value: s.visitors }))} />
              </div>
              {days !== '1' && (
                <div>
                  <div className="mb-2 text-xs font-semibold text-sub">{t(['الزوار والطلبيات يومياً', 'Visiteurs et commandes par jour'])}</div>
                  <TrendChart
                    height={180}
                    data={data.daily}
                    series={[
                      { key: 'visitors', label: t(['زوار', 'Visiteurs']) },
                      { key: 'orders', label: t('c.orders') },
                    ]}
                  />
                </div>
              )}
            </div>
          )}
          {data.totals.orders > data.totals.orders_with_page && (
            <p className="text-xs text-muted">
              {t([
                `${n0(data.totals.orders - data.totals.orders_with_page)} طلبية بلا رابط صفحة (يدوية أو من الجدول) تدخل المجموع ولا تُنسب لصفحة.`,
                `${n0(data.totals.orders - data.totals.orders_with_page)} commande(s) sans page (manuelles ou tableur) : dans le total, sans page.`,
              ])}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
