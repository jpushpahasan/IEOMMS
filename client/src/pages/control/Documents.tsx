import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Download, Eye, FolderOpen, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fileSize, fmtDate, fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, cx, Empty, Modal, PageHeader, Pagination, Spinner } from '../../components/ui';

export function Documents() {
  const { options, enumLabel } = useApp();
  const [tab, setTab] = useState<'repository' | 'expiry'>('repository');
  const [f, setF] = useState({ q: '', category: '', project_id: '', history: '', page: 1 });
  const [d, setD] = useState<any>(null);
  const [exp, setExp] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const load = useCallback(() => { setD(null); api.get(`/documents${qs(f)}`).then(setD); }, [f]);
  useEffect(load, [load]);
  useEffect(() => { api.get('/documents/expiring').then(setExp); }, []);
  const set = (k: string, v: string) => setF({ ...f, [k]: v, page: 1 });
  const alerts = exp ? exp.documents.length + exp.passports.length : 0;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Document management" subtitle="Central repository of every employee document, with version history and expiry alerts. Access is limited to authorised roles and downloads are audited." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button onClick={() => setTab('repository')} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === 'repository' ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>Repository</button>
        <button onClick={() => setTab('expiry')} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === 'expiry' ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>Expiry alerts{alerts ? ` (${alerts})` : ''}</button>
      </div>
      {tab === 'repository' && (
        <Card bodyClass="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee, file name, document number…" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
            <select className="input w-auto" value={f.category} onChange={(e) => set('category', e.target.value)} aria-label="Category"><option value="">All categories</option>{options?.enums.document_category.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <select className="input w-auto" value={f.project_id} onChange={(e) => set('project_id', e.target.value)} aria-label="Project"><option value="">All projects</option>{options?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!f.history} onChange={(e) => set('history', e.target.checked ? '1' : '')} />Include previous versions</label>
          </div>
          {!d ? <Spinner /> : d.rows.length === 0 ? <Empty icon={<FolderOpen className="size-6" />} title="No documents match" /> : (
            <>
              <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80"><tr><th className="th pl-4">Employee</th><th className="th">Category</th><th className="th">File</th><th className="th">Doc. no.</th><th className="th">Expiry</th><th className="th">Version</th><th className="th">Uploaded</th><th className="th" /></tr></thead>
                <tbody className="divide-y divide-slate-100">{d.rows.map((r: any) => (
                  <tr key={r.id} className={r.is_current ? '' : 'text-slate-400'}>
                    <td className="td pl-4"><Link to={`/candidates/${r.candidate_id}?tab=documents`} className="font-medium text-slate-800 hover:text-brand-700">{r.full_name}</Link><div className="text-xs text-slate-500">{r.reference_no} · {r.project}</div></td>
                    <td className="td">{enumLabel('document_category', r.category)}</td>
                    <td className="td"><div className="max-w-56 truncate">{r.title || r.original_name}</div><div className="text-xs text-slate-400">{fileSize(r.size_bytes)}</div></td>
                    <td className="td font-mono text-xs">{r.document_number || '—'}</td>
                    <td className={cx('td', r.days_to_expiry !== null && r.days_to_expiry < 0 ? 'font-semibold text-red-600' : r.days_to_expiry !== null && r.days_to_expiry < 60 ? 'text-amber-700' : '')}>{fmtDate(r.expiry_date)}</td>
                    <td className="td">v{r.version}{!r.is_current && ' (old)'}</td>
                    <td className="td text-xs">{fmtDateTime(r.uploaded_at)}<div className="text-slate-400">{r.uploaded_by_name}</div></td>
                    <td className="td text-right"><Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setPreview(r)}>View</Button>
                      <a href={`/api/documents/${r.id}/file?download=1`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"><Download className="size-3.5" />Download</a></td>
                  </tr>))}</tbody></table></div>
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => setF({ ...f, page: p })} />
            </>
          )}
        </Card>
      )}
      {tab === 'expiry' && (!exp ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <ExpiryList title={`Passports expiring within ${exp.windows.passports} days`} rows={exp.passports} render={(r) => <>Passport <span className="font-mono">{r.passport_number}</span></>} tab="" />
          <ExpiryList title={`Permits, visas, Emirates ID & certificates within ${exp.windows.documents} days`} rows={exp.documents} render={(r) => <>{enumLabel('document_category', r.category)}{r.document_number ? <span className="font-mono"> {r.document_number}</span> : ''}</>} tab="?tab=documents" />
        </div>
      ))}
      <Modal open={!!preview} onClose={() => setPreview(null)} size="xl" title={preview ? `${preview.full_name} — ${enumLabel('document_category', preview.category)} v${preview.version}` : ''}>
        {preview && (preview.mime_type === 'application/pdf' ? <iframe title="Preview" src={`/api/documents/${preview.id}/file`} className="h-[70vh] w-full rounded-lg border border-slate-200" />
          : <img src={`/api/documents/${preview.id}/file`} alt={preview.original_name} className="mx-auto max-h-[70vh] rounded-lg" />)}
      </Modal>
    </div>
  );
}

function ExpiryList({ title, rows, render, tab }: { title: string; rows: any[]; render: (r: any) => React.ReactNode; tab: string }) {
  return (
    <Card title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" />{title}</span>} bodyClass="p-0">
      {rows.length === 0 ? <Empty title="Nothing expiring" /> : <ul className="divide-y divide-slate-100">{rows.map((r, i) => (
        <li key={i}><Link to={`/candidates/${r.candidate_id}${tab}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
          <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800">{r.full_name}</div><div className="text-xs text-slate-500">{r.reference_no} · {render(r)}</div></div>
          <div className="text-right"><div className="text-sm">{fmtDate(r.expiry_date)}</div><Badge tone={r.days < 0 ? 'red' : r.days < 30 ? 'orange' : 'amber'}>{r.days < 0 ? 'Expired' : `${r.days} days`}</Badge></div>
        </Link></li>))}</ul>}
    </Card>
  );
}
