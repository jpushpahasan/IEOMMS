import { useState } from 'react';
import { CheckCircle2, Download, Upload, XCircle } from 'lucide-react';
import { api, ApiError, download } from '../lib/api';
import { Alert, Button, Modal, useToast } from '../components/ui';

type Result = { dryRun: boolean; total: number; valid: number; created: number;
  results: { row: number; name: string; ok: boolean; errors: string[]; warnings: string[]; reference_no?: string }[] };

export function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setFile(null); setRes(null); setError(''); };
  const close = () => { reset(); onClose(); };
  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post<Result>(`/imports/candidates${dryRun ? '?dryRun=1' : ''}`, fd);
      setRes(r);
      if (!dryRun) { toast('success', `${r.created} candidate(s) imported.`); onDone(); }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed.');
    } finally { setBusy(false); }
  };

  const committed = res && !res.dryRun;
  return (
    <Modal open={open} onClose={close} title="Import candidates from Excel" size="lg"
      footer={committed ? <Button onClick={close}>Done</Button> : <>
        <Button variant="secondary" onClick={close}>Cancel</Button>
        {!res ? <Button onClick={() => run(true)} loading={busy} disabled={!file}>Validate file</Button>
          : <Button onClick={() => run(false)} loading={busy} disabled={!res.valid}>Import {res.valid} valid row{res.valid === 1 ? '' : 's'}</Button>}
      </>}>
      <div className="space-y-4">
        {!res && (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Download the template. Drop-down lists contain the current trades, project codes, departments and agencies.</li>
              <li>Fill one candidate per row. Dates as <span className="font-mono">YYYY-MM-DD</span> or <span className="font-mono">DD/MM/YYYY</span>.</li>
              <li>Upload and validate. Nothing is saved until you confirm the import.</li>
            </ol>
            <Button variant="subtle" icon={<Download className="size-4" />} onClick={() => download('/imports/candidates/template')}>Download template</Button>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center hover:border-brand-500">
              <Upload className="size-6 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{file ? file.name : 'Choose an .xlsx file'}</span>
              <span className="text-xs text-slate-500">Up to 1,000 candidates per file</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); }} />
            </label>
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {res && (
          <>
            <Alert tone={committed ? 'success' : res.valid === res.total ? 'success' : 'warning'}>
              {committed ? `${res.created} of ${res.total} rows imported. Rows with errors were skipped — correct them and import again.`
                : `${res.valid} of ${res.total} rows are valid${res.valid < res.total ? '; rows with errors will be skipped' : ''}.`}
            </Alert>
            <div className="scroll-thin max-h-80 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="sticky top-0 bg-slate-50"><tr><th className="th">Row</th><th className="th">Name</th><th className="th">Result</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {res.results.map((r) => (
                    <tr key={r.row} className={r.ok ? '' : 'bg-red-50/50'}>
                      <td className="td align-top">{r.row}</td>
                      <td className="td align-top font-medium">{r.name || '—'}</td>
                      <td className="px-3 py-2 align-top text-sm whitespace-normal">
                        {r.ok ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" />{r.reference_no || 'Valid'}</span>
                          : <ul className="space-y-0.5 text-red-700">{r.errors.map((e, i) => <li key={i} className="flex gap-1"><XCircle className="mt-0.5 size-3.5 shrink-0" />{e}</li>)}</ul>}
                        {r.warnings.map((w, i) => <div key={i} className="mt-0.5 text-xs text-amber-700">⚠ {w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!committed && <button className="text-sm text-brand-700 hover:underline" onClick={reset}>Choose a different file</button>}
          </>
        )}
      </div>
    </Modal>
  );
}
