import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Filter, Search, UserPlus, Users, X } from 'lucide-react';
import { api, download, qs } from '../lib/api';
import { useApp } from '../lib/app';
import { daysUntil, fmtDate, initials } from '../lib/format';
import { Badge, Button, Card, cx, Empty, PageHeader, Pagination, Spinner } from '../components/ui';
import { ImportModal } from './CandidateImport';

const FILTER_KEYS = ['q', 'status', 'nationality', 'project_id', 'client_id', 'trade_id', 'department_id', 'recruitment_agency_id', 'from', 'to', 'archived', 'passport_expiring'];

export function Avatar({ name, photoId, size = 'md' }: { name: string; photoId?: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'size-8 text-xs', md: 'size-9 text-xs', lg: 'size-20 text-xl' }[size];
  if (photoId) return <img src={`/api/documents/${photoId}/file`} alt="" className={cx(s, 'shrink-0 rounded-full object-cover ring-2 ring-white')} />;
  return <span className={cx(s, 'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-navy-700 to-brand-600 font-semibold text-white')}>{initials(name)}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const { enumLabel, enumTone } = useApp();
  return <Badge tone={enumTone('candidate_status', status)} dot>{enumLabel('candidate_status', status)}</Badge>;
}

export function Candidates() {
  const { options, can } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<{ rows: any[]; total: number; page: number; pageSize: number } | null>(null);
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => k !== 'q' && sp.get(k)));
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState(sp.get('q') || '');

  const params = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const load = () => { api.get(`/candidates${qs({ pageSize: 25, ...params })}`).then(setData).catch(() => setData({ rows: [], total: 0, page: 1, pageSize: 25 })); };
  useEffect(load, [params]);
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get('q') || '') !== q) set({ q }); }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const sortBy = (key: string) => set({ sort: key, dir: sp.get('sort') === key && sp.get('dir') !== 'asc' ? 'asc' : 'desc' });
  const active = FILTER_KEYS.filter((k) => k !== 'q' && sp.get(k)).length;
  const salary = can('candidates.salary');

  const SortTh = ({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) => (
    <th className={cx('th cursor-pointer select-none hover:text-slate-800', className)} onClick={() => sortBy(k)}>
      <span className="inline-flex items-center gap-1">{children}
        {sp.get('sort') === k && (sp.get('dir') === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</span>
    </th>
  );
  const sel = (key: string, label: string, opts: { value: string | number; label: string }[]) => (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <select className="input" value={sp.get(key) || ''} onChange={(e) => set({ [key]: e.target.value })}>
        <option value="">All</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Candidates" subtitle="Register of every selected candidate across the onboarding lifecycle."
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/candidates${qs({ ...params, export: 'xlsx' })}`)}>Export</Button>
          {can('candidates.import') && <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImportOpen(true)}>Import Excel</Button>}
          {can('candidates.create') && <Button icon={<UserPlus className="size-4" />} onClick={() => nav('/candidates/new')}>New candidate</Button>}
        </>} />

      <Card bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search name, reference, passport, position, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={sp.get('status') || ''} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
              <option value="">All statuses</option>
              {options?.enums.candidate_status.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button variant={showFilters ? 'subtle' : 'secondary'} icon={<Filter className="size-4" />} onClick={() => setShowFilters((s) => !s)}>
              Filters{active > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{active}</span>}
            </Button>
            {active > 0 && <Button variant="ghost" icon={<X className="size-4" />} onClick={() => { setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>Clear</Button>}
          </div>
        </div>
        {showFilters && options && (
          <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {sel('nationality', 'Nationality', options.countries.map((c) => ({ value: c, label: c })))}
            {sel('project_id', 'Project', options.projects.map((o) => ({ value: o.id, label: o.label })))}
            {sel('client_id', 'Client', options.clients.map((o) => ({ value: o.id, label: o.label })))}
            {sel('trade_id', 'Trade', options.trades.map((o) => ({ value: o.id, label: o.label })))}
            {sel('department_id', 'Department', options.departments.map((o) => ({ value: o.id, label: o.label })))}
            {sel('recruitment_agency_id', 'Recruitment agency', options.agencies.map((o) => ({ value: o.id, label: o.label })))}
            <label className="block"><span className="label">Selected from</span><input type="date" className="input" value={sp.get('from') || ''} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="block"><span className="label">Selected to</span><input type="date" className="input" value={sp.get('to') || ''} onChange={(e) => set({ to: e.target.value })} /></label>
            {sel('archived', 'Records', [{ value: '1', label: 'Archived only' }, { value: 'all', label: 'Active + archived' }])}
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 accent-brand-600" checked={sp.get('passport_expiring') === '1'} onChange={(e) => set({ passport_expiring: e.target.checked ? '1' : '' })} />
              Passport expiring &lt; 6 months
            </label>
          </div>
        )}

        {!data ? <Spinner /> : data.rows.length === 0 ? (
          <Empty icon={<Users className="size-6" />} title="No candidates found">
            {active || sp.get('q') ? 'Try changing the search or filters.' : can('candidates.create') ? 'Register the first selected candidate or import a list from Excel.' : 'No candidates have been registered yet.'}
          </Empty>
        ) : (
          <>
            <div className="scroll-thin overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80">
                  <tr>
                    <SortTh k="full_name" className="pl-4">Candidate</SortTh>
                    <SortTh k="nationality">Nationality</SortTh>
                    <th className="th">Position / Trade</th>
                    <SortTh k="project">Project</SortTh>
                    <SortTh k="passport_expiry_date">Passport</SortTh>
                    <SortTh k="selection_date">Selected</SortTh>
                    <SortTh k="expected_joining_date">Exp. joining</SortTh>
                    {salary && <th className="th text-right">Total salary</th>}
                    <SortTh k="status">Status</SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r) => {
                    const pd = daysUntil(r.passport_expiry_date);
                    return (
                      <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => nav(`/candidates/${r.id}`)}>
                        <td className="td pl-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={r.full_name} photoId={r.photo_document_id} />
                            <div className="min-w-0">
                              <Link to={`/candidates/${r.id}`} onClick={(e) => e.stopPropagation()} className="block font-medium text-slate-900 hover:text-brand-700">{r.full_name}</Link>
                              <div className="font-mono text-xs text-slate-500">{r.reference_no}{r.is_archived && <span className="ml-2 font-sans text-amber-700">Archived</span>}</div>
                            </div>
                          </div>
                        </td>
                        <td className="td">{r.nationality}</td>
                        <td className="td"><div className="text-slate-800">{r.position}</div><div className="text-xs text-slate-500">{r.trade}</div></td>
                        <td className="td"><div className="max-w-[220px] truncate text-slate-800">{r.project}</div><div className="text-xs text-slate-500">{r.client}</div></td>
                        <td className="td">
                          <div className="font-mono text-xs">{r.passport_number}</div>
                          <div className={cx('text-xs', pd !== null && pd < 0 ? 'font-semibold text-red-600' : pd !== null && pd < 183 ? 'font-medium text-amber-700' : 'text-slate-500')}>
                            exp. {fmtDate(r.passport_expiry_date)}
                          </div>
                        </td>
                        <td className="td">{fmtDate(r.selection_date)}</td>
                        <td className="td">{fmtDate(r.expected_joining_date)}</td>
                        {salary && <td className="td text-right tabular-nums">{r.total_salary ? Number(r.total_salary).toLocaleString('en-US') : '—'}</td>}
                        <td className="td"><StatusBadge status={r.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Card>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  );
}
