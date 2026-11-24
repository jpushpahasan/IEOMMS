import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCheck, Info, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDateTime } from '../../lib/format';
import { Button, Card, cx, Empty, PageHeader, Spinner, useToast } from '../../components/ui';

const ICON = { critical: <AlertTriangle className="size-4 text-red-600" />, warning: <AlertTriangle className="size-4 text-amber-500" />, info: <Info className="size-4 text-blue-500" /> } as Record<string, JSX.Element>;

/** Header bell: unread count, polled every minute. */
export function NotificationBell() {
  const nav = useNavigate();
  const [c, setC] = useState({ unread: 0, critical: 0 });
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(() => { api.get('/notifications/count').then(setC).catch(() => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  const toggle = async () => { setOpen(!open); if (!open) setRows((await api.get('/notifications?unread=1')).rows.slice(0, 8)); };
  const go = async (n: any) => { await api.post('/notifications/read', { ids: [n.id] }); setOpen(false); load(); nav(n.link || '/notifications'); };
  return (
    <div className="relative">
      <button onClick={toggle} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${c.unread} unread)`}>
        <Bell className="size-5" />
        {c.unread > 0 && <span className={cx('absolute -top-0.5 -right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-[10px] font-bold text-white', c.critical ? 'bg-red-600' : 'bg-brand-600')}>{c.unread > 99 ? '99+' : c.unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><span className="text-sm font-semibold">Notifications</span>
              <Link to="/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-brand-700">View all</Link></div>
            {!rows ? <Spinner /> : rows.length === 0 ? <div className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</div> : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">{rows.map((n) => (
                <li key={n.id}><button onClick={() => go(n)} className="flex w-full gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50">
                  <span className="mt-0.5">{ICON[n.severity]}</span>
                  <span className="min-w-0"><span className="block text-sm font-medium text-slate-800">{n.title}</span><span className="block truncate text-xs text-slate-500">{n.message}</span></span>
                </button></li>
              ))}</ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function Notifications() {
  const { options, enumLabel } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ type: '', unread: '', history: '' });
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString(); api.get(`/notifications${p ? `?${p}` : ''}`).then(setD); }, [f]);
  useEffect(load, [load]);
  const refresh = async () => { setBusy(true); try { const r = await api.post('/notifications/refresh'); toast('info', `Checked: ${r.created} new, ${r.resolved} resolved.`); load(); } finally { setBusy(false); } };
  const readAll = async () => { await api.post('/notifications/read', {}); load(); };
  const read = async (n: any) => { if (!n.read_at) { await api.post('/notifications/read', { ids: [n.id] }); load(); } };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Notifications" subtitle="Alerts and reminders addressed to you. Items disappear automatically once the underlying issue is resolved."
        actions={<><Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={busy} onClick={refresh}>Check now</Button><Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={readAll}>Mark all read</Button></>} />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <select className="input w-auto" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type"><option value="">All types</option>
            {options?.enums.notification_type.map((o) => { const n = d?.counts.find((c: any) => c.type === o.value); return n ? <option key={o.value} value={o.value}>{o.label} ({n.n})</option> : null; })}</select>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!f.unread} onChange={(e) => setF({ ...f, unread: e.target.checked ? '1' : '' })} />Unread only</label>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!f.history} onChange={(e) => setF({ ...f, history: e.target.checked ? '1' : '' })} />Resolved history</label>
        </div>
        {!d ? <Spinner /> : d.rows.length === 0 ? <Empty icon={<Bell className="size-6" />} title={f.history ? 'No resolved notifications' : 'Nothing needs your attention'} /> : (
          <ul className="divide-y divide-slate-100">{d.rows.map((n: any) => (
            <li key={n.id} className={cx('flex gap-3 px-4 py-3', !n.read_at && !f.history && 'bg-brand-50/40')}>
              <span className="mt-0.5">{ICON[n.severity]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className={cx('text-sm', n.read_at ? 'text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                  <span className="text-[11px] text-slate-400">{enumLabel('notification_type', n.type)}</span></div>
                <div className="text-sm text-slate-600">{n.message}</div>
                <div className="mt-0.5 text-xs text-slate-400">{f.history ? `Resolved ${fmtDateTime(n.resolved_at)}` : `Raised ${fmtDateTime(n.last_raised_at)}`}{n.emailed_at ? ' · e-mailed' : ''}</div>
              </div>
              {n.link && <Link to={n.link} onClick={() => read(n)} className="self-center text-sm font-medium text-brand-700 hover:underline">Open</Link>}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
