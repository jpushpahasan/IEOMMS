import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileBarChart, FileSpreadsheet, FileText, Play } from 'lucide-react';
import { api, ApiError, download, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtMoney, fmtTs } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, PageHeader, Spinner } from '../../components/ui';

type Col = [string, string, string, number];

export function Reports() {
  const [sp, setSp] = useSearchParams();
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { api.get('/reports').then(setList); }, []);
  const key = sp.get('r');
  if (!list) return <Spinner />;
  const def = list.find((r) => r.key === key);
  if (def) return <ReportView def={def} onBack={() => setSp({}, { replace: true })} />;
  const groups = [...new Set(list.map((r) => r.group))];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Management reports" subtitle="Filter any report by date, project, client, department, nationality, agency, trade and onboarding stage, then export to Excel or PDF." />
      {list.length === 0 ? <Card><Empty icon={<FileBarChart className="size-6" />} title="No reports available for your role" /></Card> : groups.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.filter((r) => r.group === g).map((r) => (
              <button key={r.key} onClick={() => setSp({ r: r.key })} className="card flex flex-col items-start gap-1 p-4 text-left transition hover:border-brand-500/60 hover:shadow-md">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="grid size-6 place-items-center rounded-md bg-navy-900 text-[11px] text-white">{r.no}</span>{r.title}</span>
                <span className="text-xs text-slate-500">{r.description}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ReportView({ def, onBack }: { def: any; onBack: () => void }) {
  const { options, can } = useApp();
  const [f, setF] = useState<Record<string, string>>({ from: '', to: '', project_id: '', client_id: '', department_id: '', nationality: '', agency_id: '', trade_id: '', status: '' });
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const has = (k: string) => def.filters.includes(k);
  const run = async () => {
    setBusy(true); setErr('');
    try { setD(await api.get(`/reports/${def.key}${qs(f)}`)); } catch (e) { if (e instanceof ApiError) setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = (k: string, label: string, opts: { value: string | number; label: string }[]) => (
    <label className="block min-w-0"><span className="label">{label}</span>
      <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">All</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
  );
  const deptLocked = def.key.match(/department_pending|overdue_activities/) && !can('reports.view') && !can('onboarding.verify');
  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <PageHeader back={<button onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />All reports</button>}
        title={`${def.no}. ${def.title}`} subtitle={def.description}
        actions={<>
          <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => download(`/reports/${def.key}${qs({ ...f, format: 'xlsx' })}`)}>Excel</Button>
          <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => download(`/reports/${def.key}${qs({ ...f, format: 'pdf' })}`)}>PDF</Button>
        </>} />
      <Card bodyClass="grid grid-cols-2 gap-3 p-3 md:grid-cols-4 xl:grid-cols-9 items-end">
        {has('date') && <><label className="block"><span className="label">{def.dateLabel || 'Date'} from</span><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="block"><span className="label">to</span><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label></>}
        {has('project') && sel('project_id', 'Project', (options?.projects || []).map((p) => ({ value: p.id, label: p.label })))}
        {has('client') && sel('client_id', 'Client', (options?.clients || []).map((p) => ({ value: p.id, label: p.label })))}
        {has('department') && !deptLocked && sel('department_id', 'Department', (options?.departments || []).map((p) => ({ value: p.id, label: p.label })))}
        {has('nationality') && sel('nationality', 'Nationality', (options?.countries || []).map((c) => ({ value: c, label: c })))}
        {has('agency') && sel('agency_id', 'Recruitment agency', (options?.agencies || []).map((p) => ({ value: p.id, label: p.label })))}
        {has('trade') && sel('trade_id', 'Trade', (options?.trades || []).map((p) => ({ value: p.id, label: p.label })))}
        {has('status') && sel('status', 'Onboarding stage', options?.enums.candidate_status || [])}
        <Button loading={busy} icon={<Play className="size-4" />} onClick={run}>Run report</Button>
      </Card>
      {err && <Alert tone="error">{err}</Alert>}
      {deptLocked && <Alert tone="info">Showing your department's activities only.</Alert>}
      {!d ? <Spinner /> : <ReportTable d={d} />}
    </div>
  );
}

function Cell({ type, v }: { type: string; v: any }) {
  const { enumLabel, enumTone } = useApp();
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  if (type.startsWith('enum:')) return <Badge tone={enumTone(type.slice(5), v)}>{enumLabel(type.slice(5), v)}</Badge>;
  if (type === 'date') return <>{fmtDate(v)}</>;
  if (type === 'datetime') return <>{fmtTs(v)}</>;
  if (type === 'money') return <span className="tabular-nums">{fmtMoney(v).replace('AED ', '')}</span>;
  if (type === 'pct') return <span className="tabular-nums">{v}%</span>;
  if (v === 'OK') return <span className="font-semibold text-emerald-600">OK</span>;
  if (v === 'OPEN') return <span className="font-semibold text-red-600">OPEN</span>;
  return <>{String(v)}</>;
}

function ReportTable({ d }: { d: any }) {
  const cols: Col[] = d.columns;
  const right = (t: string) => ['money', 'int', 'pct'].includes(t);
  const totals = useMemo(() => d.totals || {}, [d]);
  return (
    <Card bodyClass="p-0" title={<span className="text-sm">{d.total.toLocaleString()} record(s){d.total > d.rows.length ? ` — showing the first ${d.rows.length}; exports include all` : ''}</span>}
      actions={<span className="max-w-xl truncate text-xs text-slate-500" title={d.filters}>{d.filters}</span>}>
      {d.rows.length === 0 ? <Empty title="No records match the selected filters" /> : (
        <div className="scroll-thin max-h-[65vh] overflow-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50"><tr>{cols.map(([k, h, t], i) => <th key={k} className={cx('th', i === 0 && 'pl-4', right(t) && 'text-right')}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{d.rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-slate-50/70">{cols.map(([k, , t], j) => <td key={k} className={cx('td', j === 0 && 'pl-4', right(t) && 'text-right')}><Cell type={t} v={r[k]} /></td>)}</tr>
            ))}</tbody>
            {Object.keys(totals).length > 0 && <tfoot className="sticky bottom-0 bg-slate-100 font-semibold"><tr>{cols.map(([k, , t], j) => (
              <td key={k} className={cx('td', j === 0 && 'pl-4', right(t) && 'text-right')}>{j === 0 ? 'Total' : k in totals ? (t === 'money' ? fmtMoney(totals[k]).replace('AED ', '') : totals[k]) : ''}</td>))}</tr></tfoot>}
          </table>
        </div>
      )}
    </Card>
  );
}
