import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function Button({ variant, size, loading, icon: Icon, children, className, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx('btn', variant === 'primary' && 'btn-primary', variant === 'danger' && 'btn-danger', variant === 'ghost' && 'btn-ghost', size === 'sm' && 'btn-sm', className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} {...props} className={cx('btn btn-ghost h-9 w-9 p-0', className)}>
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true, icon: Icon }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              {Icon && <Icon className="h-4 w-4 text-brand" />}
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-line/60 text-sub',
  info: 'bg-info/10 text-info',
  success: 'bg-good/10 text-good',
  good: 'bg-good/10 text-good',
  warning: 'bg-warn/15 text-warn',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-bad/10 text-bad',
  bad: 'bg-bad/10 text-bad',
  brand: 'bg-brand/10 text-brand-ink',
  purple: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
};
export function Badge({ tone = 'neutral', children, icon: Icon, className, title }) {
  return (
    <span title={title} className={cx('chip', TONES[tone] || TONES.neutral, className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function Field({ label, hint, error, children, className }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      {typeof children === 'function' ? children(id) : children}
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const Input = ({ className, ...p }) => <input {...p} className={cx('input', className)} />;
export const Textarea = ({ className, ...p }) => <textarea {...p} className={cx('input min-h-[80px]', className)} />;
export function Select({ className, options = [], placeholder, ...p }) {
  return (
    <select {...p} className={cx('input pe-8', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={cx('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'opacity-50')}>
      <span className={cx('relative inline-flex h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}>
        <input type="checkbox" className="peer sr-only" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'start-[18px]' : 'start-0.5')} />
      </span>
      {label}
    </label>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto border-b border-line', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            value === tab.value ? 'border-brand text-ink' : 'border-transparent text-sub hover:text-ink',
          )}
        >
          {tab.icon && <tab.icon className="h-4 w-4" />}
          {tab.label}
          {tab.count !== undefined && tab.count !== null && <span className={cx('chip', value === tab.value ? 'bg-brand/15 text-brand-ink' : 'bg-line/60 text-sub')}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, size }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('rounded-md px-2.5 font-medium transition', size === 'sm' ? 'py-1 text-xs' : 'py-1.5 text-sm', value === o.value ? 'bg-surface text-ink shadow-card' : 'text-sub hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-brand', className)} />;
}

export function Loading({ label }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Spinner />
      {label || t('c.loading')}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const { t, err } = useI18n();
  if (!error) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
      <XCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{err(error)}</span>
      {onRetry && (
        <Button size="sm" onClick={() => onRetry()}>
          {t('c.retry')}
        </Button>
      )}
    </div>
  );
}

export function Empty({ icon: Icon = Info, title, children, action }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-ink">{title || t('c.empty')}</p>
      {children && <div className="max-w-md text-xs text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** بطاقة مؤشر: رقم كبير + عنوان + مقارنة اختيارية */
export function Stat({ label, value, hint, icon: Icon, tone, onClick, delta, deltaGood = 'up' }) {
  const Tag = onClick ? 'button' : 'div';
  const up = delta > 0;
  const good = delta === 0 || delta === null || delta === undefined ? null : (up && deltaGood === 'up') || (!up && deltaGood === 'down');
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cx('card card-pad flex flex-col gap-1 text-start', onClick && 'transition hover:border-brand/50')}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-sub">
        <span>{label}</span>
        {Icon && <Icon className={cx('h-4 w-4', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : 'text-brand')} />}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {(hint || (delta !== undefined && delta !== null)) && (
        <div className="flex items-center gap-2 text-xs text-muted">
          {delta !== undefined && delta !== null && (
            <span className={cx('num font-medium', good === null ? 'text-sub' : good ? 'text-good' : 'text-bad')}>
              {up ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta)}%
            </span>
          )}
          {hint}
        </div>
      )}
    </Tag>
  );
}

// ——— النوافذ ———
function useEsc(onClose, open) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, open]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md', icon: Icon }) {
  useEsc(onClose, open);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" className={cx('card flex max-h-[92vh] w-full flex-col overflow-hidden shadow-pop', w)}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            {Icon && <Icon className="h-4 w-4 text-brand" />}
            {title}
          </h3>
          {onClose && <IconButton icon={X} label="close" onClick={onClose} className="h-8 w-8" />}
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised/50 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-2xl' }) {
  useEsc(onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside className={cx('flex h-full w-full flex-col border-s border-line bg-surface shadow-pop', width)}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 text-base font-semibold">{title}</div>
          <IconButton icon={X} label="close" onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

// ——— الإشعارات ———
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((tone, text) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const api = useRef(null);
  api.current ||= { ok: (t) => push('ok', t), error: (t) => push('error', t), info: (t) => push('info', t) };
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 start-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 rtl:translate-x-1/2" aria-live="polite">
          {items.map((i) => (
            <div key={i.id} className={cx('card pointer-events-auto flex items-start gap-2 px-4 py-3 text-sm shadow-pop', i.tone === 'error' && 'border-bad/40')}>
              {i.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : i.tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />}
              <span className="flex-1">{i.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** تنفيذ عملية مع إشعار نجاح/خطأ وحالة تحميل */
export function useAction() {
  const toast = useToast();
  const { err, t } = useI18n();
  const [busy, setBusy] = useState(null);
  const run = useCallback(
    async (key, fn, { success } = {}) => {
      setBusy(key);
      try {
        const out = await fn();
        if (success !== false) toast.ok(success || t('c.saved'));
        return out;
      } catch (e) {
        if (e.code !== 'cancelled') toast.error(err(e));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast, err, t],
  );
  return { busy, run };
}

export function Pagination({ total, limit, offset, onChange }) {
  const { t, dir } = useI18n();
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-sub">
      <span className="num">
        {offset + 1}–{Math.min(offset + limit, total)} {t('c.of')} {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" icon={Prev} disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
          {t('c.prev')}
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
          {t('c.next')}
          <Next className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function CopyButton({ text, size = 'sm' }) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  return (
    <Button
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* الحافظة غير متاحة */
        }
      }}
    >
      {ok ? t('c.copied') : t('c.copy')}
    </Button>
  );
}

/** شريط تقدم بسيط (لنسب التسليم والتأكيد) */
export function Bar({ value, tone = 'brand', className }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = { brand: 'bg-brand', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' }[tone];
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-line/70', className)}>
      <div className={cx('h-full rounded-full', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export const rateTone = (v, good = 75, bad = 55) => (v === null || v === undefined ? 'neutral' : v >= good ? 'good' : v >= bad ? 'warn' : 'bad');
