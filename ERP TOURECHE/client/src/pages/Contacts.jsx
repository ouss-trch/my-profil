import { useState } from 'react';
import { Contact, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea, useAction } from '../components/ui.jsx';

const KINDS = { supplier: ['مورد', 'Fournisseur'], livreur: ['موزع', 'Livreur'], carrier: ['شركة توصيل', 'Transporteur'], partner: ['شريك', 'Partenaire'], customer: ['زبون', 'Client'], other: ['أخرى', 'Autre'] };

export default function Contacts() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [kind, setKind] = useState('');
  const { data, error, loading, reload } = useApi(`/contacts${qs({ q: dq, kind })}`);
  const { run } = useAction();
  const [edit, setEdit] = useState(null);
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Contact}
        title={t('nav.contacts')}
        subtitle={t(['الموردون، الموزعون، الشركاء…', 'Fournisseurs, livreurs, partenaires…'])}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', kind: 'supplier', company: '', phone: '', email: '', notes: '' })}>
            {t('c.add')}
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c.search')} />
        <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)} placeholder={t('c.all')} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v) }))} />
      </div>
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : data.length ? (
          <table className="table">
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted">{c.company}</div>
                  </td>
                  <td>
                    <Badge>{t(KINDS[c.kind] || KINDS.other)}</Badge>
                  </td>
                  <td>
                    {c.phone && (
                      <a className="ltr link" href={`tel:${c.phone}`}>
                        {c.phone}
                      </a>
                    )}
                    {c.email && <div className="text-xs text-muted">{c.email}</div>}
                  </td>
                  <td className="max-w-xs truncate text-xs text-sub">{c.notes}</td>
                  <td>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...c })} />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run('d', () => api.del(`/contacts/${c.id}`)).then((r) => r && reload(true))} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon={Contact} />
        )}
      </Card>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? t('c.edit') : t('c.add')}
          footer={
            <Button
              variant="primary"
              disabled={!edit.name?.trim()}
              onClick={() => run('s', () => (edit.id ? api.patch(`/contacts/${edit.id}`, edit) : api.post('/contacts', edit))).then((r) => r && (setEdit(null), reload(true)))}
            >
              {t('c.save')}
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('c.name')}>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t(['النوع', 'Type'])}>
              <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v) }))} />
            </Field>
            <Field label={t(['الشركة', 'Société'])}>
              <Input value={edit.company || ''} onChange={(e) => setEdit({ ...edit, company: e.target.value })} />
            </Field>
            <Field label={t('c.phone')}>
              <Input className="ltr" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            <Field label="Email" className="sm:col-span-2">
              <Input className="ltr" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </Field>
            <Field label={t('c.notes')} className="sm:col-span-2">
              <Textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
