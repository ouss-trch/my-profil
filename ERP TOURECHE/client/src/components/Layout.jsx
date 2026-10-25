import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  Compass,
  Contact,
  History,
  Languages,
  LayoutDashboard,
  ListChecks,
  Lock,
  Megaphone,
  Menu,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Split,
  Sun,
  CalendarCheck,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApp } from './ProjectContext.jsx';
import { api, qs } from '../lib/api.js';
import { useDebounced, useLocalStorage } from '../lib/hooks.js';
import { Button, Field, IconButton, Input, Modal, Select, Textarea, cx, useAction, useToast } from './ui.jsx';
import { da } from '../lib/format.js';

export const NAV = [
  {
    group: 'nav.g.main',
    items: [
      { to: '/', key: 'nav.today', icon: CalendarCheck, end: true },
      { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
      { to: '/advisor', key: 'nav.advisor', icon: Compass, highlight: true },
      { to: '/assistant', key: 'nav.assistant', icon: Bot },
    ],
  },
  {
    group: 'nav.g.sales',
    items: [
      { to: '/orders', key: 'nav.orders', icon: ShoppingBag },
      { to: '/leads', key: 'nav.leads', icon: ShoppingCart },
      { to: '/customers', key: 'nav.customers', icon: Users },
      { to: '/carriers', key: 'nav.carriers', icon: Truck },
    ],
  },
  {
    group: 'nav.g.catalog',
    items: [{ to: '/products', key: 'nav.products', icon: Package }],
  },
  {
    group: 'nav.g.marketing',
    items: [
      { to: '/ads', key: 'nav.ads', icon: Megaphone },
      { to: '/splits', key: 'nav.splits', icon: Split },
    ],
  },
  {
    group: 'nav.g.admin',
    items: [
      { to: '/finance', key: 'nav.finance', icon: Wallet },
      { to: '/tasks', key: 'nav.tasks', icon: ListChecks },
      { to: '/contacts', key: 'nav.contacts', icon: Contact },
      { to: '/activity', key: 'nav.activity', icon: History, admin: true },
      { to: '/settings', key: 'nav.settings', icon: Settings },
    ],
  },
];

function Sidebar({ open, onClose, counts }) {
  const { t } = useI18n();
  const { auth } = useApp();
  return (
    <>
      <div className={cx('fixed inset-0 z-30 bg-black/40 lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} />
      <aside
        className={cx(
          'fixed inset-y-0 start-0 z-40 flex w-64 shrink-0 flex-col border-e border-line bg-surface transition-transform lg:static',
          open ? 'translate-x-0' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">T</span>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide">ERP TOURECHE</div>
              <div className="text-[10px] text-muted">COD · Shopify · Meta</div>
            </div>
          </div>
          <IconButton icon={X} label={t('c.close')} className="lg:hidden" onClick={onClose} />
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t(g.group)}</div>
              <ul className="space-y-0.5">
                {g.items
                  .filter((i) => !i.admin || auth.user?.role === 'admin')
                  .map((i) => (
                    <li key={i.to}>
                      <NavLink
                        to={i.to}
                        end={i.end}
                        onClick={onClose}
                        className={({ isActive }) =>
                          cx(
                            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
                            isActive ? 'bg-brand/10 font-semibold text-brand-ink' : 'text-sub hover:bg-raised hover:text-ink',
                          )
                        }
                      >
                        <i.icon className={cx('h-[18px] w-[18px] shrink-0', i.highlight && 'text-brand')} />
                        <span className="flex-1 truncate">{t(i.key)}</span>
                        {counts?.[i.to] ? <span className="chip bg-bad/15 text-bad">{counts[i.to]}</span> : null}
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

function CommandPalette({ open, onClose }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [res, setRes] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setRes(null);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);
  useEffect(() => {
    if (dq.trim().length < 2) return setRes(null);
    let live = true;
    api.get(`/search${qs({ q: dq })}`).then((r) => live && setRes(r), () => {});
    return () => {
      live = false;
    };
  }, [dq]);
  const pages = useMemo(() => NAV.flatMap((g) => g.items).filter((i) => !q || t(i.key).toLowerCase().includes(q.toLowerCase())), [q, t]);
  const go = (to) => {
    onClose();
    nav(to);
  };
  return (
    <Modal open={open} onClose={onClose} title={t('c.search')} icon={Search} size="lg">
      <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'ar' ? 'رقم طلبية، هاتف، اسم زبون، منتج، تتبع…' : 'N° commande, téléphone, client, produit, suivi…'} />
      <div className="mt-3 space-y-3 text-sm">
        {res?.orders?.length > 0 && (
          <Group title={t('nav.orders')}>
            {res.orders.map((o) => (
              <Row key={o.id} onClick={() => go(`/orders?open=${o.id}`)}>
                <span className="font-medium">{o.shopify_name || o.ref}</span>
                <span className="text-sub">{o.customer_name}</span>
                <span className="ltr text-muted">{o.phone}</span>
                <span className="ms-auto num">{da(o.total)}</span>
              </Row>
            ))}
          </Group>
        )}
        {res?.products?.length > 0 && (
          <Group title={t('c.products')}>
            {res.products.map((p) => (
              <Row key={p.id} onClick={() => go(`/products/${p.id}`)}>
                <span className="font-medium">{p.title}</span>
                <span className="ms-auto num text-sub">{da(p.price)}</span>
              </Row>
            ))}
          </Group>
        )}
        {res?.tasks?.length > 0 && (
          <Group title={t('nav.tasks')}>
            {res.tasks.map((x) => (
              <Row key={x.id} onClick={() => go('/tasks')}>
                {x.title}
              </Row>
            ))}
          </Group>
        )}
        {res?.contacts?.length > 0 && (
          <Group title={t('nav.contacts')}>
            {res.contacts.map((x) => (
              <Row key={x.id} onClick={() => go('/contacts')}>
                {x.name} <span className="ltr text-muted">{x.phone}</span>
              </Row>
            ))}
          </Group>
        )}
        <Group title={lang === 'ar' ? 'الصفحات' : 'Pages'}>
          {pages.map((p) => (
            <Row key={p.to} onClick={() => go(p.to)}>
              <p.icon className="h-4 w-4 text-muted" />
              {t(p.key)}
            </Row>
          ))}
        </Group>
      </div>
    </Modal>
  );
}
const Group = ({ title, children }) => (
  <div>
    <div className="mb-1 text-[11px] font-semibold uppercase text-muted">{title}</div>
    <div className="space-y-0.5">{children}</div>
  </div>
);
const Row = ({ children, onClick }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-raised">
    {children}
  </button>
);

export function NewTaskModal({ open, onClose, preset }) {
  const { t } = useI18n();
  const { projects, project } = useApp();
  const { run, busy } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (open) setF({ title: '', notes: '', priority: 'normal', due_at: '', project_id: project === 'all' ? '' : project, ...preset });
  }, [open, preset, project]);
  const save = async () => {
    const r = await run('save', () => api.post('/tasks', { ...f, due_at: f.due_at || null }));
    if (r) onClose(true);
  };
  return (
    <Modal
      open={open}
      onClose={() => onClose(false)}
      title={t('c.newTask')}
      icon={Plus}
      footer={
        <>
          <Button onClick={() => onClose(false)}>{t('c.cancel')}</Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!f.title?.trim()} onClick={save}>
            {t('c.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t(['العنوان', 'Titre'])} className="sm:col-span-2">
          <Input autoFocus value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t(['الأولوية', 'Priorité'])}>
          <Select
            value={f.priority}
            onChange={(e) => setF({ ...f, priority: e.target.value })}
            options={[
              { value: 'low', label: t(['منخفضة', 'Basse']) },
              { value: 'normal', label: t(['عادية', 'Normale']) },
              { value: 'high', label: t(['عالية', 'Haute']) },
            ]}
          />
        </Field>
        <Field label={t(['الموعد', 'Échéance'])}>
          <Input type="datetime-local" value={f.due_at || ''} onChange={(e) => setF({ ...f, due_at: e.target.value })} />
        </Field>
        <Field label={t('c.project')} className="sm:col-span-2">
          <Select value={f.project_id || ''} onChange={(e) => setF({ ...f, project_id: e.target.value })} placeholder={t('c.allProjects')} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label={t('c.notes')} className="sm:col-span-2">
          <Textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function ProjectSwitcher() {
  const { t } = useI18n();
  const { projects, project, setProject } = useApp();
  if (!projects.length) return null;
  return (
    <select value={project} onChange={(e) => setProject(e.target.value)} className="input w-auto max-w-[11rem] py-1.5 text-sm font-medium" aria-label={t('c.project')}>
      {projects.length > 1 && <option value="all">{t('c.allProjects')}</option>}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export default function Layout() {
  const { t, lang, setLang } = useI18n();
  const { auth, refreshAuth } = useApp();
  const toast = useToast();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [theme, setTheme] = useLocalStorage('erp.theme.v', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const [syncing, setSyncing] = useState(false);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('erp.theme', theme);
    } catch {
      /* */
    }
  }, [theme]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // شارات العدّ في القائمة (تنتظر التأكيد، الملاحظات الحرجة)
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get('/orders/counts')
        .then((c) => live && setCounts({ '/orders': (c.new || 0) + (c.no_answer || 0) + (c.callback || 0) || 0 }))
        .catch(() => {});
    load();
    const id = setInterval(load, 60e3);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [location.pathname]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await api.post('/system/sync', {});
      toast.ok(t(['تمت المزامنة', 'Synchronisé']));
      window.dispatchEvent(new Event('erp:refresh'));
    } catch (e) {
      toast.error(e.code === 'project_required' ? t('err.project_required') : e.code || 'error');
    } finally {
      setSyncing(false);
    }
  };

  const lock = async () => {
    await api.post('/auth/logout', {}).catch(() => {});
    await refreshAuth();
  };

  return (
    <div className="flex h-full">
      <Sidebar open={menu} onClose={() => setMenu(false)} counts={counts} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-4">
          <IconButton icon={Menu} label="menu" className="lg:hidden" onClick={() => setMenu(true)} />
          <ProjectSwitcher />
          <button type="button" onClick={() => setPalette(true)} className="input hidden max-w-xs items-center gap-2 py-1.5 text-start text-muted md:flex">
            <Search className="h-4 w-4" />
            <span className="flex-1 truncate">{t('c.search')}</span>
            <kbd className="ltr rounded border border-line px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
          <IconButton icon={Search} label={t('c.search')} className="md:hidden" onClick={() => setPalette(true)} />
          <div className="flex-1" />
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setTaskOpen(true)} className="hidden sm:inline-flex">
            {t('c.newTask')}
          </Button>
          <IconButton icon={RefreshCw} label={t('c.sync')} onClick={syncNow} className={syncing ? 'animate-spin' : ''} />
          <IconButton icon={theme === 'dark' ? Sun : Moon} label={t('c.theme')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
          <button type="button" onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')} className="btn btn-ghost h-9 px-2 text-xs font-semibold" title={t('c.language')}>
            <Languages className="h-4 w-4" />
            {lang === 'ar' ? 'FR' : 'ع'}
          </button>
          <IconButton icon={Lock} label={t('c.lock')} onClick={lock} />
          <span className="ms-1 hidden h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand-ink sm:flex" title={auth.user?.display_name}>
            {(auth.user?.display_name || auth.user?.username || '?').slice(0, 1).toUpperCase()}
          </span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <NewTaskModal
        open={taskOpen}
        onClose={(saved) => {
          setTaskOpen(false);
          if (saved) window.dispatchEvent(new Event('erp:refresh'));
        }}
      />
    </div>
  );
}

/** عنوان الصفحة مع الوصف والأزرار */
export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {Icon && <Icon className="h-5 w-5 text-brand" />}
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
