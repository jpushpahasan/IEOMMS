import { Fragment, useEffect, useMemo, useState } from 'react';
import { KeyRound, Lock, Pencil, Plus, ShieldCheck, Unlock } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';

export function UsersPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="User management" subtitle="Accounts, roles and what each role is allowed to do." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {(['users', 'roles'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === t ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {t === 'users' ? 'Users' : 'Roles & permissions'}
          </button>
        ))}
      </div>
      {tab === 'users' ? <Users /> : <Roles />}
    </div>
  );
}

function Users() {
  const { options, user: me } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const load = () => api.get('/admin/users').then(setRows);
  useEffect(() => { load(); api.get('/admin/roles').then((r) => setRoles(r.roles)); }, []);
  if (!rows) return <Spinner />;
  const filtered = rows.filter((u) => !q || `${u.full_name} ${u.username} ${u.role_name} ${u.email || ''}`.toLowerCase().includes(q.toLowerCase()));
  const unlock = async (u: any) => { await api.put(`/admin/users/${u.id}`, { unlock: true }); toast('success', `${u.full_name} unlocked.`); load(); };

  return (
    <Card bodyClass="p-0" title={`${rows.length} users`} actions={<>
      <input className="input w-56" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ is_active: true, must_change_password: true })}>Add user</Button>
    </>}>
      <div className="scroll-thin overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr><th className="th pl-4">Name</th><th className="th">Username</th><th className="th">Role</th><th className="th">Department</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((u) => {
              const locked = u.locked_until && new Date(u.locked_until) > new Date();
              return (
                <tr key={u.id}>
                  <td className="td pl-4"><div className="font-medium text-slate-800">{u.full_name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                  <td className="td font-mono text-xs">{u.username}</td>
                  <td className="td">{u.role_name}</td>
                  <td className="td">{u.department_name || '—'}</td>
                  <td className="td text-xs">{fmtDateTime(u.last_login_at)}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Disabled</Badge>}
                      {locked && <Badge tone="red"><Lock className="size-3" />Locked</Badge>}
                      {u.must_change_password && <Badge tone="amber">Temp. password</Badge>}
                    </div>
                  </td>
                  <td className="td text-right">
                    <div className="flex justify-end gap-1">
                      {locked && <Button size="sm" variant="ghost" icon={<Unlock className="size-3.5" />} onClick={() => unlock(u)}>Unlock</Button>}
                      <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setReset(u)}>Reset password</Button>
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit({ ...u, role_id: String(u.role_id), department_id: u.department_id ? String(u.department_id) : '' })}>Edit</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && <UserModal init={edit} roles={roles} departments={options?.departments || []} self={edit.id === me?.id} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {reset && <ResetModal user={reset} onClose={() => setReset(null)} onDone={() => { setReset(null); load(); }} />}
    </Card>
  );
}

function UserModal({ init, roles, departments, self, onClose, onDone }: { init: any; roles: any[]; departments: any[]; self: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>({ username: '', full_name: '', email: '', phone: '', role_id: '', department_id: '', password: '', ...init });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const creating = !init.id;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const submit = async () => {
    setBusy(true); setErr({});
    const body = { username: f.username, full_name: f.full_name, email: f.email, phone: f.phone, role_id: f.role_id, department_id: f.department_id, is_active: f.is_active,
      ...(creating ? { password: f.password, must_change_password: f.must_change_password } : {}) };
    try {
      if (creating) await api.post('/admin/users', body); else await api.put(`/admin/users/${init.id}`, body);
      toast('success', creating ? 'User created.' : 'User updated.');
      onDone();
    } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={creating ? 'Add user' : `Edit ${init.full_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{creating ? 'Create user' : 'Save'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Full name" required error={err.full_name}><input className="input" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
        <Field label="Username" required error={err.username}><input className="input" value={f.username} onChange={(e) => set('username', e.target.value)} /></Field>
        <Field label="Email" error={err.email}><input className="input" type="email" value={f.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone" error={err.phone}><input className="input" value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Role" required error={err.role_id}>
          <select className="input" value={f.role_id} disabled={self} onChange={(e) => set('role_id', e.target.value)}>
            <option value="">Select…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Department" error={err.department_id}>
          <select className="input" value={f.department_id} onChange={(e) => set('department_id', e.target.value)}>
            <option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
        {creating && <Field label="Temporary password" required error={err.password} hint="10+ characters, upper & lower case and a number." className="sm:col-span-2">
          <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>}
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-brand-600" checked={!!f.is_active} disabled={self} onChange={(e) => set('is_active', e.target.checked)} />Account active</label>
        {creating && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-brand-600" checked={!!f.must_change_password} onChange={(e) => set('must_change_password', e.target.checked)} />Must change password at first sign-in</label>}
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/admin/users/${user.id}/reset-password`, { password: pw }); toast('success', 'Password reset. The user must change it at next sign-in.'); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details?.password || e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Reset password — ${user.full_name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Reset password</Button></>}>
      <Field label="New temporary password" error={err} hint="The user's active sessions are signed out."><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    </Modal>
  );
}

function Roles() {
  const toast = useToast();
  const [data, setData] = useState<{ roles: any[]; permissions: any[] } | null>(null);
  const [draft, setDraft] = useState<Record<number, Set<string>>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const load = () => api.get('/admin/roles').then((d) => { setData(d); setDraft(Object.fromEntries(d.roles.map((r: any) => [r.id, new Set(r.permissions)]))); });
  useEffect(() => { load(); }, []);
  const modules = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const p of data?.permissions || []) (m[p.module] ||= []).push(p);
    return m;
  }, [data]);
  if (!data) return <Spinner />;
  const toggle = (rid: number, code: string) => setDraft((d) => { const s = new Set(d[rid]); if (s.has(code)) s.delete(code); else s.add(code); return { ...d, [rid]: s }; });
  const dirty = (r: any) => { const a = [...draft[r.id]].sort().join(); return a !== [...r.permissions].sort().join(); };
  const save = async (r: any) => {
    setSaving(r.id);
    try { await api.put(`/admin/roles/${r.id}/permissions`, { permissions: [...draft[r.id]] }); toast('success', `${r.name} permissions saved. Users get them on their next request.`); await load(); }
    catch (e) { if (e instanceof ApiError) toast('error', e.message); } finally { setSaving(null); }
  };
  return (
    <Card bodyClass="p-0" title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" />Permission matrix</span>}>
      <div className="scroll-thin max-h-[70vh] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e2e8f0]">
            <tr>
              <th className="th sticky left-0 z-20 min-w-64 bg-white pl-4">Permission</th>
              {data.roles.map((r) => (
                <th key={r.id} className="th px-2 text-center align-bottom normal-case">
                  <div className="w-24 text-[11px] leading-tight font-semibold whitespace-normal text-slate-700">{r.name}</div>
                  <div className="text-[10px] font-normal text-slate-400">{r.user_count} user{r.user_count === 1 ? '' : 's'}</div>
                  {r.code !== 'super_admin' && dirty(r) && <Button size="sm" className="mt-1 px-2 py-0.5" loading={saving === r.id} onClick={() => save(r)}>Save</Button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(modules).map(([mod, perms]) => (
              <Fragment key={mod}>
                <tr className="bg-slate-50"><td colSpan={data.roles.length + 1} className="sticky left-0 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{mod}</td></tr>
                {perms.map((p) => (
                  <tr key={p.code} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="sticky left-0 bg-white px-4 py-2"><div className="text-slate-800">{p.description}</div><div className="font-mono text-[10px] text-slate-400">{p.code}</div></td>
                    {data.roles.map((r) => (
                      <td key={r.id} className="px-2 py-2 text-center">
                        <input type="checkbox" className="size-4 accent-brand-600" checked={draft[r.id]?.has(p.code)} disabled={r.code === 'super_admin'} onChange={() => toggle(r.id, p.code)} aria-label={`${r.name}: ${p.description}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
