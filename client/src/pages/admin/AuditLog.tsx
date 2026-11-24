import { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Badge, Card, Empty, PageHeader, Pagination, Spinner } from '../../components/ui';

const TONE: Record<string, string> = { create: 'green', update: 'blue', delete: 'red', login: 'slate', login_failed: 'red', status_change: 'amber', archive: 'purple', export: 'indigo' };

export function AuditLog() {
  const [f, setF] = useState({ entity: '', action: '', user: '', from: '', to: '', page: 1 });
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api.get(`/admin/audit${qs(f)}`).then(setData); }, [f]);
  const set = (k: string, v: string) => setF({ ...f, [k]: v, page: 1 });
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Audit log" subtitle="Every sign-in, change, upload and export, with who did it and from where." />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-3 md:grid-cols-5">
          <select className="input" value={f.entity} onChange={(e) => set('entity', e.target.value)} aria-label="Record type">
            <option value="">All records</option>
            {['candidates', 'employee_documents', 'users', 'roles', 'projects', 'clients', 'trades', 'recruitment_agencies', 'departments', 'system_settings'].map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
          </select>
          <select className="input" value={f.action} onChange={(e) => set('action', e.target.value)} aria-label="Action">
            <option value="">All actions</option>
            {['create', 'update', 'status_change', 'archive', 'restore', 'delete', 'deactivate', 'login', 'login_failed', 'logout', 'password_change', 'password_reset', 'document_upload', 'document_version', 'document_download', 'export', 'import', 'update_permissions'].map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
          </select>
          <input className="input" placeholder="Username" value={f.user} onChange={(e) => set('user', e.target.value)} />
          <input type="date" className="input" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="From" />
          <input type="date" className="input" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        </div>
        {!data ? <Spinner /> : data.rows.length === 0 ? <Empty title="No audit entries match" /> : (
          <>
            <div className="scroll-thin overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80"><tr><th className="th pl-4">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Record</th><th className="th">IP</th><th className="th">Details</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r: any) => (
                    <tr key={r.id} className="align-top">
                      <td className="td pl-4 text-xs">{fmtDateTime(r.created_at)}</td>
                      <td className="td">{r.username || 'system'}</td>
                      <td className="td"><Badge tone={TONE[r.action] || 'slate'}>{r.action.replace(/_/g, ' ')}</Badge></td>
                      <td className="td text-xs">{r.entity.replace(/_/g, ' ')}{r.entity_id ? ` #${r.entity_id}` : ''}</td>
                      <td className="td font-mono text-xs">{r.ip || '—'}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {(r.old_values || r.new_values) ? (
                          open === r.id ? (
                            <div className="max-w-xl space-y-1">
                              {r.old_values && <pre className="overflow-x-auto rounded bg-red-50 p-2 whitespace-pre-wrap text-red-900">{JSON.stringify(r.old_values, null, 1)}</pre>}
                              {r.new_values && <pre className="overflow-x-auto rounded bg-emerald-50 p-2 whitespace-pre-wrap text-emerald-900">{JSON.stringify(r.new_values, null, 1)}</pre>}
                              <button className="text-brand-700" onClick={() => setOpen(null)}>Hide</button>
                            </div>
                          ) : <button className="text-brand-700 hover:underline" onClick={() => setOpen(r.id)}>Show changes</button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
