import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X, XCircle } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ buttons
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
};
export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', VARIANTS[variant], className)}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ badges
const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20', blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20', cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25', orange: 'bg-orange-50 text-orange-700 ring-orange-600/25',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', green: 'bg-green-100 text-green-800 ring-green-600/25',
  purple: 'bg-purple-50 text-purple-700 ring-purple-600/20', red: 'bg-red-50 text-red-700 ring-red-600/20',
};
export const TONE_HEX: Record<string, string> = {
  slate: '#64748b', blue: '#2563eb', indigo: '#4f46e5', cyan: '#0891b2', amber: '#d97706', orange: '#ea580c',
  emerald: '#059669', green: '#16a34a', purple: '#9333ea', red: '#dc2626',
};
export function Badge({ tone = 'slate', children, dot }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONES[tone] || TONES.slate)}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: TONE_HEX[tone] || TONE_HEX.slate }} />}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ layout bits
export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={bodyClass ?? 'p-4'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="size-5 animate-spin text-brand-600" />{label}</div>
);

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon}</div>}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  const s = { info: ['bg-blue-50 text-blue-800 border-blue-200', Info], warning: ['bg-amber-50 text-amber-900 border-amber-200', AlertTriangle],
    error: ['bg-red-50 text-red-800 border-red-200', XCircle], success: ['bg-emerald-50 text-emerald-800 border-emerald-200', CheckCircle2] }[tone] as [string, typeof Info];
  const Icon = s[1];
  return <div className={cx('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', s[0])}><Icon className="mt-0.5 size-4 shrink-0" /><div className="min-w-0">{children}</div></div>;
}

// ------------------------------------------------------------------ form fields
export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

// ------------------------------------------------------------------ modal
export function Modal({ open, onClose, title, children, footer, size = 'md' }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', w)}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close"><X className="size-5" /></button>
        </header>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pagination
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500">
      <span>{from}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-4" />}>Prev</Button>
        <span className="px-2 text-xs">Page {page} / {pages}</span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg',
            t.tone === 'success' ? 'bg-emerald-600' : t.tone === 'error' ? 'bg-red-600' : 'bg-navy-900')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : t.tone === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Stat({ label, value, icon, tone = 'slate', sub, onClick }: { label: string; value: ReactNode; icon?: ReactNode; tone?: string; sub?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="card group flex w-full items-start gap-3 p-4 text-left transition enabled:hover:border-brand-500/50 enabled:hover:shadow-md disabled:cursor-default">
      {icon && <div className="rounded-lg p-2" style={{ background: `${TONE_HEX[tone]}14`, color: TONE_HEX[tone] }}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className={cx('mt-0.5 font-semibold tabular-nums text-slate-900', typeof value === 'string' && value.length > 8 ? 'text-lg' : 'text-2xl')}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      </div>
    </button>
  );
}
