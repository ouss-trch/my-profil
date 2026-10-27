import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { cx } from './ui.jsx';

/** الطلبيات الأخيرة تصل دون رابط صفحتها: بدونه تبقى أرقام الصفحات واختبارات A/B صفراً (صفحات المتجر + اختبار الصفحات) */
export default function AttributionNotice({ health, className }) {
  const { t } = useI18n();
  if (!health || health.ok || !health.orders) return null;
  return (
    <div role="status" className={cx('flex gap-3 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm leading-7', className)}>
      <AlertTriangle className="mt-1.5 h-4 w-4 shrink-0 text-warn" />
      <div className="min-w-0">
        <b className="text-ink">{t(['الطلبيات تصل دون رابط الصفحة التي جاء منها الزبون', 'Les commandes arrivent sans leur page d’origine'])}</b>
        <p className="text-sub">
          {t(['{p} فقط من آخر {n} طلبية ({d} يوماً) تحمل رابط صفحتها، فلا تُنسب الطلبيات للصفحات ولا لنسخ اختبار A/B.', 'Seulement {p} des {n} dernières commandes ({d} jours) portent leur page : ni les pages ni les versions A/B ne peuvent être créditées.'], {
            p: health.with_page,
            n: health.orders,
            d: health.days,
          })}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t(['الحل في n8n: سير طلبيات COD يجب أن يضيف إلى الطلبية في Shopify الخصائص landing_page و utm_content (نموذج الطلب يرسلهما أصلاً). الطلبيات القديمة لا تُستدرك؛ الجديدة تُنسب تلقائياً.', 'Correctif dans n8n : le workflow des commandes COD doit ajouter landing_page et utm_content à la commande Shopify (le formulaire les envoie déjà). Les anciennes commandes ne sont pas rattrapées ; les nouvelles seront attribuées.'])}
        </p>
      </div>
    </div>
  );
}
