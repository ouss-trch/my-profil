import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, Radio } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { ago, n0 } from '../lib/format.js';
import { BarsChart } from './charts.jsx';
import { PageCell } from './Traffic.jsx';
import { Card, ErrorBox, Loading, Segmented, Stat, cx } from './ui.jsx';

const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const hours = (list, lang) => list.map(hh).join(lang === 'ar' ? '، ' : ', ');

/** نقطة خضراء نابضة: الزوار الآن (تتوقف عن النبض لمن يفضّل تقليل الحركة) */
const Dot = ({ on }) => <span className={cx('inline-block h-2.5 w-2.5 rounded-full', on ? 'bg-good motion-safe:animate-pulse' : 'bg-line')} aria-hidden />;

/** شارة صغيرة للشريط العلوي: كم زائراً الآن. تفتح صفحات المتجر حيث التفاصيل */
export function LivePill() {
  const { t } = useI18n();
  const { data } = useApi('/pages/live', { interval: 15e3 });
  if (!data) return null;
  return (
    <Link className="btn btn-sm" to="/store-pages" title={t(['زوار المتجر الآن (آخر {m} دقائق)', 'Visiteurs de la boutique en ce moment ({m} dernières minutes)'], { m: data.minutes })}>
      <Dot on={data.now > 0} />
      <span className="num font-semibold">{n0(data.now)}</span> {t(['الآن', 'en direct'])}
    </Link>
  );
}

/** الزوار الآن بدقة (يتجدد كل 10 ثوانٍ) + متى يدخل الزوار ومتى تأتي الطلبيات، بتوقيت الجزائر */
export default function LiveVisitors() {
  const { t, lang } = useI18n();
  const [days, setDays] = useState('14');
  const live = useApi('/pages/live', { interval: 10e3 });
  const hrs = useApi(`/pages/hours?days=${days}`);
  const l = live.data;
  const h = hrs.data;
  const chart = h ? h.hours.map((x) => ({ label: String(x.hour).padStart(2, '0'), visitors: x.visitors, orders: x.orders })) : [];
  return (
    <Card
      icon={Radio}
      title={t(['الزوار الآن وأوقات الذروة', 'Visiteurs en direct et heures de pointe'])}
      subtitle={t(['الرقم الحيّ لمن دخل أو لمس النموذج في آخر {m} دقائق. الذروة بتوقيت الجزائر.', 'Nombre exact de personnes actives ces {m} dernières minutes. Heures de pointe en heure d’Alger.'], { m: l?.minutes || 5 })}
    >
      {live.loading && !l ? (
        <Loading />
      ) : live.error ? (
        <ErrorBox error={live.error} onRetry={live.reload} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="col-span-2 rounded-xl border border-line bg-raised p-3 lg:col-span-1" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-xs text-sub">
                <Dot on={l.now > 0} />
                {t(['الآن على المتجر', 'En ce moment'])}
              </div>
              <div className="num mt-1 text-4xl font-bold leading-none text-ink">{n0(l.now)}</div>
              <div className="mt-1 text-[11px] text-muted">{l.last_visit_at ? `${t(['آخر نشاط', 'Dernière activité'])} ${ago(l.last_visit_at, lang)}` : t(['لا زيارة بعد', 'Aucune visite'])}</div>
            </div>
            <Stat label={t(['يملأون النموذج الآن', 'Dans le formulaire'])} value={n0(l.in_form)} hint={t(['لمسوا نموذج الطلب', 'ont touché le formulaire'])} />
            <Stat label={t(['من الإعلانات الآن', 'Depuis les pubs'])} value={n0(l.from_ad)} hint={t(['نقرة إعلان حديثة', 'clic pub récent'])} />
            <Stat label={t(['آخر 30 دقيقة', '30 dernières min'])} value={n0(l.last_30)} />
            <Stat label={t(['اليوم', 'Aujourd’hui'])} value={n0(l.today)} hint={`${t(['من الإعلانات', 'via pubs'])}: ${n0(l.today_from_ad)}`} />
          </div>

          {l.pages.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-sub">{t(['الصفحات المفتوحة الآن', 'Pages ouvertes en ce moment'])}</div>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {l.pages.map((p) => (
                  <li key={`${p.project_id}:${p.key}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0 text-sm">
                      <PageCell p={p} />
                    </div>
                    <span className="num shrink-0 text-sm font-semibold">{n0(p.visitors)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-sub">
                <Clock3 className="h-3.5 w-3.5" />
                {t(['متى يدخل الزوار وتأتي الطلبيات (ساعات اليوم)', 'Quand arrivent les visiteurs et les commandes (heures)'])}
              </div>
              <Segmented size="sm" value={days} onChange={setDays} options={[{ value: '7', label: t(['7 أيام', '7 j']) }, { value: '14', label: t(['14 يوماً', '14 j']) }, { value: '30', label: t(['30 يوماً', '30 j']) }]} />
            </div>
            {hrs.loading && !h ? (
              <Loading />
            ) : h ? (
              <>
                <BarsChart
                  data={chart}
                  xKey="label"
                  reverse={false}
                  height={190}
                  series={[
                    { key: 'visitors', label: t(['زوار', 'Visiteurs']) },
                    { key: 'orders', label: t(['طلبيات', 'Commandes']) },
                  ]}
                />
                {!h.enough ? (
                  <p className="mt-2 text-xs text-muted">{t(['البيانات قليلة ({n} زائر في {d} يوماً): لا تبنِ عليها قراراً بعد، ستتضح الأوقات مع تراكم الزيارات.', 'Peu de données ({n} visiteurs en {d} j) : ne décidez pas encore dessus, les heures se préciseront avec le temps.'], { n: h.total_visitors, d: h.days })}</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs text-sub">
                    <li>
                      {t(['أكثر الساعات دخولاً: ', 'Heures les plus visitées : '])}
                      <b className="num text-ink">{hours(h.peak_visitors, lang)}</b>
                      {h.best_window && (
                        <>
                          {' · '}
                          {t(['أفضل نافذة من 3 ساعات: ', 'meilleure fenêtre de 3 h : '])}
                          <b className="num text-ink">
                            {hh(h.best_window.from)}–{hh(h.best_window.to)}
                          </b>
                        </>
                      )}
                    </li>
                    {h.total_orders > 0 && (
                      <li>
                        {t(['أكثر الساعات طلباً: ', 'Heures de plus de commandes : '])}
                        <b className="num text-ink">{hours(h.peak_orders, lang)}</b>
                        {t([' — فيها يلزم أن يكون المؤكّدون جاهزين للاتصال.', ' — les confirmateurs doivent être prêts à appeler.'])}
                      </li>
                    )}
                  </ul>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
