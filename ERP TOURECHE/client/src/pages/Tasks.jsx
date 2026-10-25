import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { NewTaskModal, PageHeader } from '../components/Layout.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Segmented, cx, useAction } from '../components/ui.jsx';

const PRIO = { high: ['عالية', 'Haute', 'bad'], normal: ['عادية', 'Normale', 'neutral'], low: ['منخفضة', 'Basse', 'neutral'] };

export default function Tasks() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState('open');
  const [mine, setMine] = useState(false);
  const { data, error, loading, reload } = useApi(`/tasks${qs({ mine: mine ? '1' : '' })}`);
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => reload(true);
    window.addEventListener('erp:refresh', h);
    return () => window.removeEventListener('erp:refresh', h);
  }, [reload]);
  const list = (data || []).filter((x) => (status === 'open' ? x.status !== 'done' : x.status === 'done'));
  const toggle = (x) => run(`t${x.id}`, () => api.patch(`/tasks/${x.id}`, { status: x.status === 'done' ? 'todo' : 'done' }), { success: false }).then(() => reload(true));
  const overdue = (x) => x.due_at && x.status !== 'done' && new Date(x.due_at) < new Date();
  return (
    <div className="space-y-4">
      <PageHeader
        icon={ListChecks}
        title={t('nav.tasks')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
            {t('c.newTask')}
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: t(['مفتوحة', 'Ouvertes']) },
            { value: 'done', label: t(['منجزة', 'Faites']) },
          ]}
        />
        <Segmented
          value={mine ? 'mine' : 'all'}
          onChange={(v) => setMine(v === 'mine')}
          options={[
            { value: 'all', label: t('c.all') },
            { value: 'mine', label: t(['مهامي', 'Les miennes']) },
          ]}
        />
      </div>
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : list.length ? (
          <ul className="divide-y divide-line">
            {list.map((x) => (
              <li key={x.id} className="flex items-start gap-3 px-4 py-3">
                <button type="button" onClick={() => toggle(x)} className="mt-0.5" aria-label="toggle">
                  {x.status === 'done' ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-muted" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cx('text-sm font-medium', x.status === 'done' && 'text-muted line-through')}>{x.title}</div>
                  {x.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-sub">{x.notes}</p>}
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <Badge tone={PRIO[x.priority]?.[2]}>{t(PRIO[x.priority] || PRIO.normal)}</Badge>
                    {x.due_at && <Badge tone={overdue(x) ? 'bad' : 'neutral'}>{dateTime(x.due_at, lang)}</Badge>}
                    {x.project_name && <Badge>{x.project_name}</Badge>}
                    {x.assignee_name && <Badge tone="info">{x.assignee_name}</Badge>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run('d', () => api.del(`/tasks/${x.id}`), { success: false }).then(() => reload(true))} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={ListChecks} title={status === 'open' ? t(['لا مهام مفتوحة', 'Aucune tâche ouverte']) : t(['لا مهام منجزة', 'Aucune tâche faite'])} />
        )}
      </Card>
      <NewTaskModal open={open} onClose={(ok) => (setOpen(false), ok && reload(true))} />
    </div>
  );
}
