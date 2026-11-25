import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { Alert, Badge, Button, Card, cx, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';

export type Col = { key: string; label: string; type?: 'text' | 'select' | 'bool' | 'country'; options?: () => { value: string | number; label: string }[]; required?: boolean; list?: boolean; show?: (r: any) => string };

export function SettingsPage() {
  const { options, can, enumLabel } = useApp();
  const [tab, setTab] = useState('projects');
  const TABS: Record<string, { title: string; cols: Col[] }> = {
    projects: { title: 'Projects', cols: [
      { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Project name', required: true },
      { key: 'client_id', label: 'Client', type: 'select', required: true, options: () => (options?.clients || []).map((c) => ({ value: c.id, label: c.label })), show: (r) => r.client_name },
      { key: 'location', label: 'Location' }, { key: 'emirate', label: 'Emirate', type: 'select', options: () => options?.enums.emirate || [] },
    ] },
    clients: { title: 'Clients', cols: [
      { key: 'name', label: 'Client name', required: true }, { key: 'contact_person', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    ] },
    trades: { title: 'Trades', cols: [
      { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Trade name', required: true },
      { key: 'category', label: 'Category', type: 'select', required: true, options: () => options?.enums.trade_category || [], show: (r) => enumLabel('trade_category', r.category) },
    ] },
    recruitment_agencies: { title: 'Recruitment agencies', cols: [
      { key: 'name', label: 'Agency name', required: true }, { key: 'country', label: 'Country', type: 'country' }, { key: 'licence_no', label: 'Licence no.' },
      { key: 'contact_person', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    ] },
    departments: { title: 'Departments', cols: [
      { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true },
      { key: 'manager_user_id', label: 'Department manager', type: 'select', options: () => (options?.users || []).map((u) => ({ value: u.id, label: u.label })), show: (r) => r.manager_name },
    ] },
  };
  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Settings" subtitle="Reference lists used across the system, and general configuration." />
      <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
        {[...Object.entries(TABS).map(([k, t]) => [k, t.title]), ...(can('settings.manage') ? [['general', 'General']] : [])].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{t}</button>
        ))}
      </div>
      {tab === 'general' ? <General /> : <MasterTable key={tab} masterKey={tab} title={TABS[tab].title} cols={TABS[tab].cols} />}
    </div>
  );
}

export function MasterTable({ masterKey, title, cols, readOnly }: { masterKey: string; title: string; cols: Col[]; readOnly?: boolean }) {
  const { reloadOptions } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const load = () => api.get(`/masters/${masterKey}`).then(setRows);
  useEffect(() => { load(); }, [masterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (r: any) => {
    if (!confirm(`Remove "${r.name}"? Records already in use are deactivated instead of deleted.`)) return;
    const res = await api.del(`/masters/${masterKey}/${r.id}`);
    toast('success', res.deactivated ? `Deactivated (used by ${res.usage} record${res.usage === 1 ? '' : 's'}).` : 'Deleted.');
    load(); reloadOptions();
  };
  if (!rows) return <Spinner />;
  return (
    <Card bodyClass="p-0" title={`${title} (${rows.length})`} actions={!readOnly && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ is_active: true })}>Add</Button>}>
      <div className="scroll-thin overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr>{cols.map((c, i) => <th key={c.key} className={cx('th', i === 0 && 'pl-4')}>{c.label}</th>)}<th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'text-slate-400'}>
                {cols.map((c, i) => <td key={c.key} className={cx('td', i === 0 && 'pl-4 font-medium')}>{c.type === 'bool' ? (r[c.key] ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>) : (c.show ? c.show(r) : r[c.key]) || '—'}</td>)}
                <td className="td">{r.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="td text-right">{!readOnly && <>
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : v])))}>Edit</Button>
                  {r.is_active && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => remove(r)}>Remove</Button>}
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <MasterModal masterKey={masterKey} title={title} cols={cols} init={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); reloadOptions(); }} />}
    </Card>
  );
}

function MasterModal({ masterKey, title, cols, init, onClose, onDone }: { masterKey: string; title: string; cols: Col[]; init: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const toast = useToast();
  const [f, setF] = useState<any>(init);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr({});
    const body: any = { is_active: !!f.is_active };
    for (const c of cols) body[c.key] = c.type === 'bool' ? !!f[c.key] : f[c.key] ?? '';
    try {
      if (init.id) await api.put(`/masters/${masterKey}/${init.id}`, body); else await api.post(`/masters/${masterKey}`, body);
      toast('success', 'Saved.');
      onDone();
    } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${init.id ? 'Edit' : 'Add'} — ${title}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        {cols.map((c) => (
          <Field key={c.key} label={c.label} required={c.required} error={err[c.key]}>
            {c.type === 'bool' ? (
              <label className="flex items-center gap-2 pt-2 text-sm text-slate-700"><input type="checkbox" className="accent-brand-600" checked={!!f[c.key]} onChange={(e) => setF({ ...f, [c.key]: e.target.checked })} />Yes</label>
            ) : c.type === 'select' || c.type === 'country' ? (
              <select className="input" value={f[c.key] ?? ''} onChange={(e) => setF({ ...f, [c.key]: e.target.value })}>
                <option value="">{c.required ? 'Select…' : '—'}</option>
                {(c.type === 'country' ? (options?.countries || []).map((x) => ({ value: x, label: x })) : c.options!()).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : <input className="input" value={f[c.key] ?? ''} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />}
          </Field>
        ))}
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-brand-600" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>
      </div>
    </Modal>
  );
}

function General() {
  const toast = useToast();
  const { refresh } = useApp();
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/admin/settings').then((r) => setF(r.settings)); }, []);
  if (!f) return <Spinner />;
  const save = async () => {
    setBusy(true); setErr({});
    try { const r = await api.put('/admin/settings', f); setF(r.settings); toast('success', 'Settings saved.'); refresh(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  const num = (k: string, label: string, hint: string) => (
    <Field label={label} hint={hint} error={err[k]}><input type="number" className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <Card title="General settings" actions={<Button size="sm" onClick={save} loading={busy}>Save settings</Button>}>
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Company name" error={err.company_name} className="sm:col-span-2"><input className="input" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
        <Field label="Candidate reference prefix" error={err.reference_prefix} hint={`Next numbers look like ${f.reference_prefix}-${new Date().getFullYear()}-00001`}>
          <input className="input uppercase" value={f.reference_prefix} onChange={(e) => setF({ ...f, reference_prefix: e.target.value.toUpperCase() })} /></Field>
        {num('passport_min_validity_months', 'Minimum passport validity (months)', 'Warn when a passport expires sooner than this after joining.')}
        {num('min_age', 'Minimum candidate age', 'Registrations below this age are rejected.')}
        {num('max_age', 'Maximum candidate age (warning)', 'Above this age a warning is shown.')}
        <h4 className="mt-2 text-xs font-semibold tracking-wider text-slate-500 uppercase sm:col-span-2">Notifications & reminders</h4>
        <Field label="Remind responsible person … days before the planned date" hint="Comma-separated, e.g. 3, 1" error={err.reminder_days_before}>
          <input className="input" value={Array.isArray(f.reminder_days_before) ? f.reminder_days_before.join(', ') : f.reminder_days_before} onChange={(e) => setF({ ...f, reminder_days_before: e.target.value })} /></Field>
        <div className="space-y-2 pt-6">
          {[['remind_on_due_date', 'Remind on the due date'], ['overdue_daily_reminder', 'Remind daily while overdue'], ['email_notifications', 'Also send warnings and critical alerts by e-mail']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>))}
        </div>
        {num('passport_expiry_alert_days', 'Passport expiry alert window (days)', 'Alert when a passport expires within this many days.')}
        {num('document_expiry_alert_days', 'Document expiry alert window (days)', 'Permits, visas, Emirates ID and certificates.')}
      </div>
      <Outbox />
      <Backups />
    </Card>
  );
}

function Backups() {
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/admin/backups').then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  if (d.managed) return (
    <div className="mt-6 border-t border-slate-100 pt-4">
      <h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Database backups</h4>
      <p className="text-xs text-slate-500">This server uses a hosted database: backups and point-in-time restore are provided by the database service (Neon console → your project → Backup &amp; Restore). Documents are kept in Vercel Blob storage.</p>
    </div>
  );
  const run = async () => { setBusy(true); try { const r = await api.post('/admin/backups'); toast(r.status === 'ok' ? 'success' : 'error', r.status === 'ok' ? `Backup ${r.name} completed.` : `Backup failed: ${r.error}`); load(); } finally { setBusy(false); } };
  return (
    <div className="mt-6 border-t border-slate-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Database backups</h4>
        <Button size="sm" variant="secondary" loading={busy} onClick={run}>Back up now</Button>
      </div>
      <p className="mb-2 text-xs text-slate-500">Automatic daily backup after 02:00 GST of the database ({d.database}) and all uploaded documents; the latest 30 are kept in <span className="font-mono">data/backups</span>.</p>
      {d.backups.length === 0 ? <p className="text-sm text-slate-500">No backups yet.</p> : (
        <table className="min-w-full divide-y divide-slate-100 text-xs">
          <thead><tr><th className="th">Backup</th><th className="th">Type</th><th className="th">Database</th><th className="th">Documents</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.backups.slice(0, 10).map((b: any) => (
            <tr key={b.name}><td className="px-3 py-1.5 font-mono">{b.name}</td><td className="px-3 py-1.5">{b.reason}</td><td className="px-3 py-1.5">{b.database_bytes ? `${Math.round(b.database_bytes / 1024)} KB` : '—'}</td>
              <td className="px-3 py-1.5">{b.documents ?? '—'}</td><td className="px-3 py-1.5"><Badge tone={b.status === 'ok' ? 'green' : 'red'}>{b.status}</Badge>{b.error && <span className="ml-1 text-red-600">{b.error}</span>}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function Outbox() {
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const load = () => api.get('/admin/outbox').then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  return (
    <div className="mt-6 border-t border-slate-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">E-mail outbox ({d.rows.length})</h4>
        <Button size="sm" variant="secondary" onClick={async () => { const r = await api.post('/admin/outbox/retry'); toast('info', r.held !== undefined ? `SMTP not configured: ${r.held} held.` : `${r.sent} sent.`); load(); }}>Retry sending</Button>
      </div>
      {!d.smtp && <Alert tone="info">SMTP is not configured, so e-mails are kept in the outbox. Set <span className="font-mono">SMTP_URL</span> (e.g. smtps://user:pass@mail.example.com) and <span className="font-mono">SMTP_FROM</span> on the server to send them.</Alert>}
      {d.rows.length > 0 && <div className="scroll-thin mt-2 max-h-64 overflow-y-auto"><table className="min-w-full divide-y divide-slate-100 text-xs">
        <thead><tr><th className="th">To</th><th className="th">Subject</th><th className="th">Status</th><th className="th">Queued</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{d.rows.map((r: any) => <tr key={r.id}><td className="px-3 py-1.5">{r.to_address}</td><td className="px-3 py-1.5">{r.subject}</td>
          <td className="px-3 py-1.5"><Badge tone={r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}>{r.status}</Badge></td><td className="px-3 py-1.5">{String(r.created_at).slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
      </table></div>}
    </div>
  );
}
