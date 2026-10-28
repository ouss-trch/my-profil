import { History } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, Empty, ErrorBox, Loading } from '../components/ui.jsx';

/** سجل النشاط: كل عملية حساسة (حذف، أسعار، ميزانيات، تفعيل، إعدادات) بمن ومتى */
export default function Activity() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi('/audit?limit=400');
  return (
    <div className="space-y-4">
      <PageHeader icon={History} title={t('nav.activity')} subtitle={t(['كل العمليات الحساسة: من فعلها ومتى', 'Toutes les actions sensibles : qui et quand'])} />
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : data.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('c.date')}</th>
                  <th>{t(['المستخدم', 'Utilisateur'])}</th>
                  <th>{t(['العملية', 'Action'])}</th>
                  <th>{t('c.project')}</th>
                  <th>{t('c.details')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs text-muted">{dateTime(a.at, lang)}</td>
                    <td>{a.user_name || '—'}</td>
                    <td>
                      <Badge tone={/deleted|unlink|blacklist/.test(a.action) ? 'bad' : /price|budget|activate|launched|settings/.test(a.action) ? 'warn' : 'neutral'}>{a.action}</Badge>
                    </td>
                    <td className="text-xs">{a.project_name || '—'}</td>
                    <td className="ltr max-w-md truncate text-xs text-sub" title={a.details || ''}>
                      {a.entity ? `${a.entity}#${a.entity_id} ` : ''}
                      {a.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={History} />
        )}
      </Card>
    </div>
  );
}
