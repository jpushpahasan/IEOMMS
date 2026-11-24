import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { Alert, Badge, Button, Card, cx, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';

export function OnboardingSetup() {
  const [tab, setTab] = useState<'templates' | 'catalogue'>('templates');
  const [defs, setDefs] = useState<any[] | null>(null);
  const loadDefs = useCallback(() => { api.get('/onboarding/definitions').then(setDefs); }, []);
  useEffect(loadDefs, [loadDefs]);
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader back={<Link to="/onboarding" className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Onboarding</Link>}
        title="Onboarding templates & activity catalogue" subtitle="Configure which activities apply per trade and project, and the rules of each activity. Changes apply to checklists generated afterwards." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {([['templates', 'Templates'], ['catalogue', 'Activity catalogue']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
      </div>
      {!defs ? <Spinner /> : tab === 'templates' ? <Templates defs={defs} /> : <Catalogue defs={defs} onChange={loadDefs} />}
    </div>
  );
}

function Templates({ defs }: { defs: any[] }) {
  const { options } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [create, setCreate] = useState(false);
  const load = () => api.get('/onboarding/templates').then(setRows);
  useEffect(() => { load(); }, []);
  if (!rows) return <Spinner />;
  return (
    <Card title="Templates" bodyClass="p-0" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreate(true)}>New template</Button>}>
      <div className="px-4 pt-3 text-xs text-slate-500">The most specific active template is used: trade + project → trade → project → default.</div>
      <table className="mt-2 min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50/80"><tr><th className="th pl-4">Template</th><th className="th">Trade</th><th className="th">Project</th><th className="th">Overrides</th><th className="th">Used by</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((t) => (
          <tr key={t.id}><td className="td pl-4"><div className="font-medium">{t.name}</div><div className="max-w-md truncate text-xs text-slate-500">{t.description}</div></td>
            <td className="td">{t.trade || 'Any'}</td><td className="td">{t.project || 'Any'}</td>
            <td className="td">{t.items.filter((i: any) => !i.is_applicable).length} not applicable · {t.items.filter((i: any) => i.is_applicable).length} changed</td>
            <td className="td">{t.used_by}</td><td className="td">{t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
            <td className="td text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(t)}>Edit</Button></td></tr>
        ))}</tbody>
      </table>
      {edit && <TemplateEditor t={edit} defs={defs} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); toast('success', 'Template saved.'); }} />}
      {create && <CreateTemplate trades={options?.trades || []} projects={options?.projects || []} onClose={() => setCreate(false)} onDone={() => { setCreate(false); load(); }} />}
    </Card>
  );
}

function CreateTemplate({ trades, projects, onClose, onDone }: { trades: any[]; projects: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', trade_id: '', project_id: '', description: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = async () => {
    try { await api.post('/onboarding/templates', f); onDone(); } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); }
  };
  return (
    <Modal open onClose={onClose} title="New onboarding template" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={submit}>Create</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Name" required error={err.name} className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Trade"><select className="input" value={f.trade_id} onChange={(e) => setF({ ...f, trade_id: e.target.value })}><option value="">Any trade</option>{trades.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Project"><select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Any project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Field label="Description" className="sm:col-span-2"><textarea rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function TemplateEditor({ t, defs, onClose, onDone }: { t: any; defs: any[]; onClose: () => void; onDone: () => void }) {
  const init = useMemo(() => Object.fromEntries(defs.filter((d) => d.is_active).map((d) => {
    const it = t.items.find((i: any) => i.definition_id === d.id);
    return [d.id, { applicable: it ? it.is_applicable : true, mandatory: it?.is_mandatory ?? null, offset: it?.offset_days ?? '' }];
  })), [t, defs]);
  const [items, setItems] = useState<Record<number, { applicable: boolean; mandatory: boolean | null; offset: string | number }>>(init);
  const [meta, setMeta] = useState({ name: t.name, description: t.description || '', is_active: t.is_active });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = (d: any) => ['clearance', 'deployment_approval', 'deployed'].includes(d.workflow_key);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.put(`/onboarding/templates/${t.id}`, { ...meta, items: Object.entries(items).map(([id, v]) => ({ definition_id: Number(id), is_applicable: v.applicable, is_mandatory: v.mandatory, offset_days: v.offset === '' ? null : Number(v.offset) })) });
      onDone();
    } catch (e) { if (e instanceof ApiError) setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={`Template — ${t.name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>Save template</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <Field label="Name"><input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={meta.is_active} onChange={(e) => setMeta({ ...meta, is_active: e.target.checked })} />Active</label>
        </div>
        <div className="scroll-thin max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="sticky top-0 bg-slate-50"><tr><th className="th pl-3">Activity</th><th className="th">Applies</th><th className="th">Mandatory</th><th className="th">Offset days (default)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{defs.filter((d) => d.is_active).map((d) => {
              const v = items[d.id];
              return (
                <tr key={d.id} className={v.applicable ? '' : 'bg-slate-50 text-slate-400'}>
                  <td className="px-3 py-1.5">{d.seq}. {d.name}<span className="ml-1 text-xs text-slate-400">({d.section}, {d.anchor})</span></td>
                  <td className="px-3 py-1.5"><input type="checkbox" className="accent-brand-600" disabled={locked(d)} checked={v.applicable} onChange={(e) => setItems({ ...items, [d.id]: { ...v, applicable: e.target.checked } })} /></td>
                  <td className="px-3 py-1.5"><select className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={v.mandatory === null ? '' : v.mandatory ? 'y' : 'n'} disabled={!v.applicable}
                    onChange={(e) => setItems({ ...items, [d.id]: { ...v, mandatory: e.target.value === '' ? null : e.target.value === 'y' } })}>
                    <option value="">Default ({d.is_mandatory ? 'yes' : 'no'})</option><option value="y">Yes</option><option value="n">No</option></select></td>
                  <td className="px-3 py-1.5"><input className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs" placeholder={String(d.offset_days)} value={v.offset} disabled={!v.applicable}
                    onChange={(e) => setItems({ ...items, [d.id]: { ...v, offset: e.target.value } })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function Catalogue({ defs, onChange }: { defs: any[]; onChange: () => void }) {
  const { enumLabel } = useApp();
  const [edit, setEdit] = useState<any>(null);
  return (
    <Card title={`Activity catalogue (${defs.length})`} bodyClass="p-0" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ section: 'F', anchor: 'arrival', offset_days: '5', is_mandatory: true, is_active: true })}>Custom activity</Button>}>
      <div className="scroll-thin max-h-[70vh] overflow-auto"><table className="min-w-full divide-y divide-slate-100">
        <thead className="sticky top-0 bg-slate-50"><tr><th className="th pl-4">#</th><th className="th">Activity</th><th className="th">Department</th><th className="th">Planned</th><th className="th">Rules</th><th className="th">Completed by</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{defs.map((d) => (
          <tr key={d.id} className={d.is_active ? '' : 'text-slate-400'}>
            <td className="td pl-4 tabular-nums">{d.seq}</td><td className="td"><div className="font-medium">{d.name}</div><div className="text-xs text-slate-500">Section {d.section}</div></td>
            <td className="td">{d.department}</td><td className="td text-xs">{d.anchor === 'arrival' ? 'Arrival' : 'Selection'} {d.offset_days >= 0 ? '+' : ''}{d.offset_days} days</td>
            <td className="td"><div className="flex flex-wrap gap-1">{d.is_mandatory && <Badge tone="indigo">Mandatory</Badge>}{d.requires_document && <Badge tone="orange">{enumLabel('document_category', d.document_category)}</Badge>}{d.requires_verification && <Badge tone="amber">Verification</Badge>}</div></td>
            <td className="td text-xs">{d.workflow_key ? `Automatic (${d.workflow_key.replace(':', ' → ')})` : 'Manual'}</td>
            <td className="td text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit({ ...d, department_id: String(d.department_id), offset_days: String(d.offset_days) })}>Edit</Button></td>
          </tr>
        ))}</tbody></table></div>
      {edit && <DefModal d={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChange(); }} />}
    </Card>
  );
}

function DefModal({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const toast = useToast();
  const [f, setF] = useState<any>({ name: d.name || '', section: d.section, department_id: d.department_id || '', is_mandatory: !!d.is_mandatory, requires_document: !!d.requires_document,
    document_category: d.document_category || '', requires_verification: !!d.requires_verification, anchor: d.anchor, offset_days: d.offset_days, description: d.description || '', is_active: d.is_active !== false });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = async () => {
    try { d.id ? await api.put(`/onboarding/definitions/${d.id}`, f) : await api.post('/onboarding/definitions', f); toast('success', 'Saved. Applies to checklists generated from now on.'); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); }
  };
  const chk = (k: string, l: string, disabled = false) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" disabled={disabled} checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>;
  return (
    <Modal open onClose={onClose} title={d.id ? `Edit activity ${d.seq}` : 'New custom activity'} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Activity name" required error={err.name} className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Section" error={err.section}><select className="input" value={f.section} disabled={d.is_system} onChange={(e) => setF({ ...f, section: e.target.value })}>{options?.enums.section.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
        <Field label="Department" required error={err.department_id}><select className="input" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">Select…</option>{options?.departments.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
        <Field label="Planned relative to"><select className="input" value={f.anchor} onChange={(e) => setF({ ...f, anchor: e.target.value })}><option value="selection">Selection date</option><option value="arrival">Arrival date</option></select></Field>
        <Field label="Offset (days)" error={err.offset_days}><input className="input" value={f.offset_days} onChange={(e) => setF({ ...f, offset_days: e.target.value })} /></Field>
        <div className="space-y-2 sm:col-span-2">{chk('is_mandatory', 'Mandatory')}{chk('requires_verification', 'Requires verification by HR before completion')}{chk('requires_document', 'Requires a supporting document')}</div>
        {f.requires_document && <Field label="Document category" required error={err.document_category}><select className="input" value={f.document_category} onChange={(e) => setF({ ...f, document_category: e.target.value })}><option value="">Select…</option>{options?.enums.document_category.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>}
        <Field label="Description" className="sm:col-span-2"><textarea rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {!d.is_system && chk('is_active', 'Active')}
      </div>
    </Modal>
  );
}
