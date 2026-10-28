import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, Handshake, MessageCircle, PackageSearch, Pencil, Phone, Plus, Store, Trash2, Truck, Users } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { n0, waLink } from '../lib/format.js';
import { PageHeader } from '../components/Layout.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { CARRIER_NAMES } from '../components/status.jsx';
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Tabs, Textarea, useAction } from '../components/ui.jsx';

// كل نوع مربوط بعمل فعلي: المورد ← إعادة الطلب، التوصيل ← الطرود العالقة
const KINDS = {
  supplier: { label: ['الموردون', 'Fournisseurs'], one: ['مورد', 'Fournisseur'], icon: Store },
  delivery: { label: ['مكاتب وموزعو التوصيل', 'Bureaux & livreurs'], one: ['مكتب / موزع', 'Bureau / livreur'], icon: Truck },
  service: { label: ['خدمات', 'Prestataires'], one: ['خدمة', 'Prestataire'], icon: Briefcase },
  wholesale: { label: ['زبائن الجملة', 'Clients en gros'], one: ['زبون جملة', 'Client en gros'], icon: Users },
  other: { label: ['أخرى', 'Autres'], one: ['أخرى', 'Autre'], icon: Handshake },
};
const ROLES = { desk: ['مكتب / Stop desk', 'Bureau / Stop desk'], livreur: ['موزع', 'Livreur'], manager: ['مسؤول الحساب', 'Chargé de compte'] };
const HINTS = {
  supplier: ['اربط كل منتج بمورده من صفحة المنتج: يقترح الـ ERP متى تطلب وكم، ويجهّز رسالة الطلب.', 'Liez chaque produit à son fournisseur : l’ERP propose quand et combien commander, et prépare le message.'],
  delivery: ['رقم المكتب أو الموزع لكل شركة وولاية. يظهر داخل الطلبية عندما يتعثر الطرد (في المكتب أو محاولة فاشلة).', 'Numéro du bureau ou du livreur par transporteur et wilaya. Il s’affiche dans la commande quand le colis bloque.'],
  service: ['المطبعة، المصوّر، المصمم، المؤثرون… من تعمل معهم بانتظام.', 'Imprimeur, photographe, designer, influenceurs… vos prestataires réguliers.'],
  wholesale: ['المكتبات والمدارس والمحلات التي تشتري بالجملة.', 'Librairies, écoles et boutiques qui achètent en gros.'],
  other: ['', ''],
};

const blank = (kind) => ({ name: '', kind, company: '', phone: '', email: '', notes: '', carrier: kind === 'delivery' ? 'yalidine' : '', wilaya_code: '', role: 'desk', lead_time_days: '' });

function PhoneActions({ phone, text }) {
  if (!phone) return null;
  const wa = waLink(phone, text);
  return (
    <span className="inline-flex items-center gap-1">
      <a className="btn btn-sm" href={`tel:${phone}`} title={phone}>
        <Phone className="h-3.5 w-3.5" />
        <span className="ltr num">{phone}</span>
      </a>
      {wa && (
        <a className="btn btn-sm" href={wa} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp">
          <MessageCircle className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}

function orderMessage(s, lang) {
  const lines = s.reorder.map((p) => `- ${p.title}: ${p.suggested_qty ?? '?'}`);
  return lang === 'ar' ? `السلام عليكم ${s.name}،\nنحتاج الكميات التالية:\n${lines.join('\n')}\nمتى يمكن التسليم؟` : `Bonjour ${s.name},\nNous avons besoin de :\n${lines.join('\n')}\nQuel délai de livraison ?`;
}

function SupplierCard({ s, onEdit, onDelete }) {
  const { t, lang } = useI18n();
  const msg = s.reorder?.length ? orderMessage(s, lang) : null;
  return (
    <Card>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-ink">{s.name}</b>
              {s.reorder?.length > 0 && <Badge tone="warn">{t([`${s.reorder.length} للطلب`, `${s.reorder.length} à commander`])}</Badge>}
              {s.lead_time_days !== null && <Badge>{t([`التوريد خلال ${s.lead_time_days} يوم`, `Livre en ${s.lead_time_days} j`])}</Badge>}
            </div>
            {s.company && <div className="text-xs text-muted">{s.company}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <PhoneActions phone={s.phone} />
            <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label={t('c.edit')} />
            <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} aria-label={t('c.delete')} />
          </div>
        </div>

        {s.reorder?.length > 0 && (
          <div className="space-y-2 rounded-lg border border-warn/30 bg-warn/5 p-3">
            <div className="text-xs font-medium text-ink">{t(['يحتاج إعادة طلب الآن', 'À recommander maintenant'])}</div>
            <ul className="space-y-1 text-sm">
              {s.reorder.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="link min-w-0 truncate" to={`/products/${p.id}`}>
                    {p.title}
                  </Link>
                  <span className="num text-xs text-sub">
                    {t(['المخزون', 'Stock'])} {n0(p.stock)}
                    {p.days_left !== null && ` · ${t([`يكفي ${p.days_left} يوم`, `${p.days_left} j restants`])}`}
                    {p.suggested_qty ? ` · ${t(['اطلب', 'Commander'])} ${n0(p.suggested_qty)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {waLink(s.phone, msg) && (
                <a className="btn btn-sm btn-primary" href={waLink(s.phone, msg)} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {t(['إرسال الطلب عبر واتساب', 'Envoyer la commande (WhatsApp)'])}
                </a>
              )}
              <CopyButton text={msg} />
            </div>
            <p className="text-[11px] text-muted">{t(['الكمية المقترحة تكفي أسبوعين بعد وصول السلعة، حسب بيع آخر 14 يوماً.', 'Quantité suggérée : 2 semaines de ventes après réception (base : 14 derniers jours).'])}</p>
          </div>
        )}

        {s.products?.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {s.products.map((p) => (
              <Link key={p.id} to={`/products/${p.id}`} className="chip bg-raised text-sub hover:text-ink">
                {p.title}
                <span className="num text-muted">· {n0(p.stock)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">{t(['لا منتجات مربوطة بعد. افتح المنتج واختر هذا المورد.', 'Aucun produit lié. Ouvrez un produit et choisissez ce fournisseur.'])}</p>
        )}
        {s.notes && <p className="whitespace-pre-line text-xs text-sub">{s.notes}</p>}
      </div>
    </Card>
  );
}

function DeliveryTable({ rows, onEdit, onDelete }) {
  const { t, lang } = useI18n();
  const { wilayaName } = useApp();
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{t('c.carrier')}</th>
            <th>{t('c.wilaya')}</th>
            <th>{t('c.name')}</th>
            <th>{t('c.phone')}</th>
            <th>{t(['طرود عالقة', 'Colis bloqués'])}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <b>{CARRIER_NAMES[c.carrier] || c.carrier}</b>
                <div className="text-xs text-muted">{t(ROLES[c.role] || ROLES.desk)}</div>
              </td>
              <td>{c.wilaya_code ? wilayaName(c.wilaya_code, lang) : <span className="text-muted">{t(['كل الولايات', 'Toutes'])}</span>}</td>
              <td>
                <div className="font-medium">{c.name}</div>
                {c.company && <div className="text-xs text-muted">{c.company}</div>}
              </td>
              <td>
                <PhoneActions phone={c.phone} />
              </td>
              <td>
                {c.stuck > 0 ? (
                  <Link className="link num" to={`/orders${qs({ tab: 'shipping', carrier: c.carrier, wilaya: c.wilaya_code || undefined })}`}>
                    {t([`${c.stuck} طرد`, `${c.stuck} colis`])}
                  </Link>
                ) : (
                  <span className="text-muted">0</span>
                )}
              </td>
              <td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(c)} aria-label={t('c.edit')} />
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onDelete(c)} aria-label={t('c.delete')} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ rows, onEdit, onDelete }) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <div className="font-medium">{c.name}</div>
                {c.company && <div className="text-xs text-muted">{c.company}</div>}
              </td>
              <td>
                <PhoneActions phone={c.phone} />
                {c.email && <div className="ltr mt-1 text-xs text-muted">{c.email}</div>}
              </td>
              <td className="max-w-xs whitespace-pre-line text-xs text-sub">{c.notes}</td>
              <td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(c)} aria-label={t('c.edit')} />
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onDelete(c)} aria-label={t('c.delete')} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactForm({ edit, setEdit }) {
  const { t, lang } = useI18n();
  const { meta, wilayaName } = useApp();
  const set = (patch) => setEdit({ ...edit, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t(['النوع', 'Type'])} className="sm:col-span-2">
        <Select value={edit.kind} onChange={(e) => set({ kind: e.target.value, carrier: e.target.value === 'delivery' ? edit.carrier || 'yalidine' : edit.carrier })} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v.one) }))} />
      </Field>
      {edit.kind === 'delivery' && (
        <>
          <Field label={t('c.carrier')}>
            <Select value={edit.carrier || ''} onChange={(e) => set({ carrier: e.target.value })} options={Object.entries(CARRIER_NAMES).map(([k, v]) => ({ value: k, label: v }))} />
          </Field>
          <Field label={t('c.wilaya')}>
            <Select value={edit.wilaya_code || ''} onChange={(e) => set({ wilaya_code: e.target.value })} placeholder={t(['كل الولايات', 'Toutes les wilayas'])} options={(meta?.wilayas || []).map((w) => ({ value: w.code, label: wilayaName(w.code, lang) }))} />
          </Field>
          <Field label={t(['الصفة', 'Rôle'])} className="sm:col-span-2">
            <Select value={edit.role || 'desk'} onChange={(e) => set({ role: e.target.value })} options={Object.entries(ROLES).map(([k, v]) => ({ value: k, label: t(v) }))} />
          </Field>
        </>
      )}
      <Field label={t('c.name')}>
        <Input value={edit.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label={t('c.phone')}>
        <Input className="ltr" inputMode="tel" value={edit.phone || ''} onChange={(e) => set({ phone: e.target.value })} placeholder="05 / 06 / 07…" />
      </Field>
      <Field label={t(['الشركة / المحل', 'Société / boutique'])}>
        <Input value={edit.company || ''} onChange={(e) => set({ company: e.target.value })} />
      </Field>
      {edit.kind === 'supplier' ? (
        <Field label={t(['مدة التوريد (أيام)', 'Délai de livraison (jours)'])} hint={t(['تُستعمل لتنبيهك قبل نفاد المخزون بوقت كافٍ', 'Sert à vous alerter assez tôt avant la rupture'])}>
          <Input className="ltr" type="number" min="0" value={edit.lead_time_days ?? ''} onChange={(e) => set({ lead_time_days: e.target.value })} />
        </Field>
      ) : (
        <Field label="Email">
          <Input className="ltr" type="email" value={edit.email || ''} onChange={(e) => set({ email: e.target.value })} />
        </Field>
      )}
      <Field label={t('c.notes')} className="sm:col-span-2">
        <Textarea value={edit.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

export default function Contacts() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const kind = KINDS[params.get('kind')] ? params.get('kind') : 'supplier';
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [carrier, setCarrier] = useState('');
  const { data, error, loading, reload } = useApi(`/contacts${qs({ q: dq, kind, carrier: kind === 'delivery' ? carrier : undefined })}`);
  const { run, busy } = useAction();
  const [edit, setEdit] = useState(null);
  const rows = data?.rows || [];
  const sorted = kind === 'supplier' ? [...rows].sort((a, b) => (b.reorder?.length || 0) - (a.reorder?.length || 0)) : rows;
  const remove = (c) => run('d', () => api.del(`/contacts/${c.id}`)).then((r) => r && reload(true));
  const save = () =>
    run('s', () => {
      const body = { ...edit, wilaya_code: edit.wilaya_code || null, lead_time_days: edit.lead_time_days === '' ? null : edit.lead_time_days };
      return edit.id ? api.patch(`/contacts/${edit.id}`, body) : api.post('/contacts', body);
    }).then((r) => r && (setEdit(null), reload(true)));
  const K = KINDS[kind];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Handshake}
        title={t('nav.contacts')}
        subtitle={t(['ماذا تطلب من المورد ومتى، ومن تتصل به عندما يتعثر طرد.', 'Quoi commander et quand, et qui appeler quand un colis bloque.'])}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEdit(blank(kind))}>
            {t(['إضافة', 'Ajouter'])} {t(K.one)}
          </Button>
        }
      />
      <Tabs value={kind} onChange={(k) => setParams({ kind: k })} tabs={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: t(v.label), icon: v.icon, count: data?.counts?.[k] ?? 0 }))} />
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c.search')} />
        {kind === 'delivery' && <Select className="w-auto" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t(['كل الشركات', 'Tous'])} options={Object.entries(CARRIER_NAMES).map(([k, v]) => ({ value: k, label: v }))} />}
        {t(HINTS[kind]) && <p className="text-xs text-muted">{t(HINTS[kind])}</p>}
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !rows.length ? (
        <Card>
          <Empty icon={kind === 'supplier' ? PackageSearch : K.icon} title={t(['لا شيء هنا بعد', 'Rien ici pour l’instant'])} action={<Button icon={Plus} onClick={() => setEdit(blank(kind))}>{t(['إضافة', 'Ajouter'])} {t(K.one)}</Button>}>
            {t(HINTS[kind])}
          </Empty>
        </Card>
      ) : kind === 'supplier' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {sorted.map((s) => (
            <SupplierCard key={s.id} s={s} onEdit={() => setEdit({ ...s })} onDelete={() => remove(s)} />
          ))}
        </div>
      ) : (
        <Card pad={false}>{kind === 'delivery' ? <DeliveryTable rows={rows} onEdit={(c) => setEdit({ ...c })} onDelete={remove} /> : <SimpleTable rows={rows} onEdit={(c) => setEdit({ ...c })} onDelete={remove} />}</Card>
      )}

      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? t('c.edit') : `${t(['إضافة', 'Ajouter'])} ${t(KINDS[edit.kind].one)}`}
          footer={
            <Button variant="primary" loading={busy === 's'} disabled={!edit.name?.trim() || (edit.kind === 'delivery' && !edit.carrier)} onClick={save}>
              {t('c.save')}
            </Button>
          }
        >
          <ContactForm edit={edit} setEdit={setEdit} />
        </Modal>
      )}
    </div>
  );
}

/** داخل الطلبية: من نتصل به عندما يتعثر الطرد (مكتب/موزع نفس الشركة والولاية) */
export function DeliveryContacts({ order }) {
  const { t, lang } = useI18n();
  const { wilayaName } = useApp();
  const { data } = useApi(`/contacts${qs({ kind: 'delivery', carrier: order.carrier, wilaya: order.wilaya_code || undefined })}`);
  if (!data) return null;
  const msg =
    lang === 'ar'
      ? `السلام عليكم، بخصوص الطرد ${order.tracking || ''} للزبون ${order.customer_name || ''} (${wilayaName(order.wilaya_code, 'ar')}). ما وضعه؟`
      : `Bonjour, concernant le colis ${order.tracking || ''} du client ${order.customer_name || ''} (${wilayaName(order.wilaya_code, 'fr')}). Quel est son statut ?`;
  if (!data.rows.length)
    return (
      <p className="text-xs text-muted">
        {t(['لا يوجد رقم مكتب أو موزع لهذه الشركة والولاية.', 'Aucun bureau ni livreur enregistré pour ce transporteur et cette wilaya.'])}{' '}
        <Link className="link" to="/contacts?kind=delivery">
          {t(['أضفه', 'Ajouter'])}
        </Link>
      </p>
    );
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-sub">{t(['للمتابعة اتصل بـ:', 'Pour relancer, appelez :'])}</div>
      {data.rows.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised px-3 py-1.5">
          <span className="min-w-0 text-sm">
            <b>{c.name}</b> <span className="text-xs text-muted">· {t(ROLES[c.role] || ROLES.desk)}{c.wilaya_code ? ` · ${wilayaName(c.wilaya_code, lang)}` : ''}</span>
          </span>
          <PhoneActions phone={c.phone} text={msg} />
        </div>
      ))}
    </div>
  );
}
