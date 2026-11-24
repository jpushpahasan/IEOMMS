import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app';
import { fmtMoney } from '../lib/format';
import { Alert, Button, Card, cx, Field, PageHeader, Spinner, useToast } from '../components/ui';

type F = Record<string, any>;
const SALARY = ['basic_salary', 'housing_allowance', 'transport_allowance', 'food_allowance', 'other_allowance'];
const EMPTY: F = {
  full_name: '', gender: '', date_of_birth: '', nationality: '', marital_status: '', contact_number: '', email: '', current_address: '',
  emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '', passport_number: '', passport_issue_date: '',
  passport_expiry_date: '', passport_issuing_country: '', position: '', trade_id: '', department_id: '', project_id: '', work_location: '',
  employment_category: 'labour', basic_salary: '', housing_allowance: '', transport_allowance: '', food_allowance: '', other_allowance: '',
  contract_status: 'not_prepared', offer_letter_status: 'not_issued', selection_date: new Date().toISOString().slice(0, 10), expected_joining_date: '',
  recruitment_agency_id: '', source_country: '', recruitment_coordinator_id: '', educational_qualifications: '', professional_qualifications: '',
  work_experience: '', licences_certifications: '', previous_uae_experience: false, previous_uae_details: '', remarks: '',
};

export function CandidateForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const { options, can, user } = useApp();
  const [f, setF] = useState<F | null>(editing ? null : { ...EMPTY, recruitment_coordinator_id: user?.role === 'recruitment' ? String(user.id) : '' });
  const [orig, setOrig] = useState<F>({});
  const [ref, setRef] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState('');
  const salary = can('candidates.salary');

  useEffect(() => {
    if (!editing) return;
    api.get(`/candidates/${id}`).then(({ candidate: c }) => {
      const v: F = {};
      for (const k of Object.keys(EMPTY)) v[k] = c[k] ?? (typeof EMPTY[k] === 'boolean' ? false : '');
      for (const k of ['trade_id', 'department_id', 'project_id', 'recruitment_agency_id', 'recruitment_coordinator_id']) v[k] = v[k] ? String(v[k]) : '';
      setF(v); setOrig(v); setRef(c.reference_no);
    });
  }, [editing, id]);

  const total = useMemo(() => (f ? SALARY.reduce((s, k) => s + (Number(String(f[k]).replace(/,/g, '')) || 0), 0) : 0), [f]);
  const project = options?.projects.find((p) => String(p.id) === String(f?.project_id));
  if (!f || !options) return <Spinner />;

  const set = (k: string, v: unknown) => { setF({ ...f, [k]: v }); if (errors[k]) setErrors({ ...errors, [k]: '' }); };
  const inp = (k: string, label: string, o: { type?: string; required?: boolean; hint?: string; placeholder?: string; className?: string; upper?: boolean } = {}) => (
    <Field label={label} required={o.required} error={errors[k]} hint={o.hint} className={o.className}>
      <input type={o.type || 'text'} className={cx('input', errors[k] && 'invalid', o.upper && 'uppercase')} placeholder={o.placeholder} value={f[k] ?? ''}
        onChange={(e) => set(k, e.target.value)} inputMode={o.type === 'money' ? 'decimal' : undefined} />
    </Field>
  );
  const select = (k: string, label: string, opts: { value: string | number; label: string }[], o: { required?: boolean; hint?: string; className?: string; empty?: string } = {}) => (
    <Field label={label} required={o.required} error={errors[k]} hint={o.hint} className={o.className}>
      <select className={cx('input', errors[k] && 'invalid')} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
        <option value="">{o.empty ?? (o.required ? 'Select…' : '—')}</option>
        {opts.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
      </select>
    </Field>
  );
  const area = (k: string, label: string, className = 'sm:col-span-2') => (
    <Field label={label} error={errors[k]} className={className}>
      <textarea rows={3} className={cx('input', errors[k] && 'invalid')} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const enumOpts = (list: string) => options.enums[list].map((o) => ({ value: o.value, label: o.label }));
  const countryOpts = options.countries.map((c) => ({ value: c, label: c }));
  const refOpts = (list: { id: number; label: string }[]) => list.map((o) => ({ value: o.id, label: o.label }));

  const submit = async () => {
    setBusy(true); setErrors({}); setTopError('');
    const body: F = {};
    for (const [k, v] of Object.entries(f)) {
      if (!salary && SALARY.includes(k)) continue;
      if (editing && JSON.stringify(v) === JSON.stringify(orig[k])) continue;
      body[k] = v;
    }
    try {
      if (editing) {
        const r = await api.put(`/candidates/${id}`, body);
        r.warnings?.forEach((w: string) => toast('info', w));
        toast('success', 'Candidate updated.');
        nav(`/candidates/${id}`);
      } else {
        const r = await api.post('/candidates', body);
        r.warnings?.forEach((w: string) => toast('info', w));
        toast('success', `Candidate registered as ${r.reference_no}.`);
        nav(`/candidates/${r.id}?tab=documents`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.details || {});
        setTopError(e.message);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally { setBusy(false); }
  };

  const Section = ({ letter, title, children }: { letter: string; title: string; children: ReactNode }) => (
    <Card title={<span className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-md bg-navy-900 text-xs text-white">{letter}</span>{title}</span>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </Card>
  );

  return (
    <div className="mx-auto max-w-6xl pb-24">
      <PageHeader
        back={<Link to={editing ? `/candidates/${id}` : '/candidates'} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Back</Link>}
        title={editing ? `Edit candidate` : 'Register new candidate'}
        subtitle={editing ? <span className="font-mono">{ref}</span> : 'A unique reference number is issued automatically when you save.'} />
      {topError && <div className="mb-4"><Alert tone="error">{topError}</Alert></div>}

      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {Section({ letter: 'A', title: 'Personal information', children: <>
          {inp('full_name', 'Full name as per passport', { required: true, className: 'sm:col-span-2' })}
          {select('gender', 'Gender', enumOpts('gender'), { required: true })}
          {inp('date_of_birth', 'Date of birth', { type: 'date', required: true })}
          {select('nationality', 'Nationality', countryOpts, { required: true })}
          {select('marital_status', 'Marital status', enumOpts('marital_status'))}
          {inp('contact_number', 'Contact number', { placeholder: '+91 98470 12345' })}
          {inp('email', 'Email address', { type: 'email' })}
          {area('current_address', 'Current residential address', 'sm:col-span-2 lg:col-span-1')}
          <div className="sm:col-span-2 lg:col-span-3"><div className="mt-1 mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Emergency contact</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {inp('emergency_contact_name', 'Name')}{inp('emergency_contact_relation', 'Relationship')}{inp('emergency_contact_phone', 'Contact number')}
            </div></div>
          <div className="sm:col-span-2 lg:col-span-3"><div className="mt-1 mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Passport</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {inp('passport_number', 'Passport number', { required: true, upper: true })}
              {select('passport_issuing_country', 'Issuing country', countryOpts, { required: true })}
              {inp('passport_issue_date', 'Issue date', { type: 'date', required: true })}
              {inp('passport_expiry_date', 'Expiry date', { type: 'date', required: true, hint: 'UAE requires 6+ months validity' })}
            </div></div>
        </> })}

        {Section({ letter: 'B', title: 'Employment information', children: <>
          {inp('position', 'Position / designation', { required: true })}
          {select('trade_id', 'Trade / category', refOpts(options.trades), { required: true })}
          {select('department_id', 'Department', refOpts(options.departments))}
          {select('project_id', 'Project', refOpts(options.projects), { required: true, hint: project ? `Client: ${project.client || '—'}` : undefined })}
          {inp('work_location', 'Work location', { placeholder: project?.location || '' })}
          {select('employment_category', 'Employment category', enumOpts('employment_category'), { required: true })}
          {select('contract_status', 'Employment contract status', enumOpts('contract_status'), { required: true })}
          {select('offer_letter_status', 'Offer letter status', enumOpts('offer_letter_status'), { required: true })}
          {inp('selection_date', 'Selection date', { type: 'date', required: true })}
          {inp('expected_joining_date', 'Expected joining date', { type: 'date' })}
          {select('recruitment_agency_id', 'Recruitment agency', refOpts(options.agencies), { empty: 'Direct hire' })}
          {select('source_country', 'Source country', countryOpts)}
          {select('recruitment_coordinator_id', 'Recruitment coordinator', refOpts(options.users))}
          {salary && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:col-span-2 lg:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Monthly salary (AED)</span>
                <span className="text-sm text-slate-600">Total: <span className="text-base font-semibold text-navy-900 tabular-nums">{fmtMoney(total)}</span></span>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {inp('basic_salary', 'Basic salary', { type: 'money', placeholder: '0.00' })}
                {inp('housing_allowance', 'Housing', { type: 'money', placeholder: '0.00' })}
                {inp('transport_allowance', 'Transport', { type: 'money', placeholder: '0.00' })}
                {inp('food_allowance', 'Food', { type: 'money', placeholder: '0.00' })}
                {inp('other_allowance', 'Other', { type: 'money', placeholder: '0.00' })}
              </div>
            </div>
          )}
        </> })}

        {Section({ letter: 'C', title: 'Additional information', children: <>
          {area('educational_qualifications', 'Educational qualifications', 'sm:col-span-1 lg:col-span-1')}
          {area('professional_qualifications', 'Professional qualifications', 'sm:col-span-1 lg:col-span-1')}
          {area('work_experience', 'Work experience', 'sm:col-span-2 lg:col-span-1')}
          {area('licences_certifications', 'Relevant licences / certifications', 'sm:col-span-2 lg:col-span-1')}
          <div className="space-y-2 sm:col-span-2 lg:col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="size-4 accent-brand-600" checked={!!f.previous_uae_experience} onChange={(e) => set('previous_uae_experience', e.target.checked)} />
              Previous UAE employment experience
            </label>
            {f.previous_uae_experience && <textarea rows={2} className="input" placeholder="Employer, period, visa / labour card details" value={f.previous_uae_details ?? ''} onChange={(e) => set('previous_uae_details', e.target.value)} />}
          </div>
          {area('remarks', 'Special requirements or remarks', 'sm:col-span-2 lg:col-span-3')}
        </> })}
        <button type="submit" hidden />
      </form>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-6">
          <span className="mr-auto hidden text-xs text-slate-500 sm:block">Fields marked <span className="text-red-500">*</span> are required. Documents are uploaded from the profile after saving.</span>
          <Button variant="secondary" onClick={() => nav(-1)}>Cancel</Button>
          <Button onClick={submit} loading={busy} icon={<Save className="size-4" />}>{editing ? 'Save changes' : 'Register candidate'}</Button>
        </div>
      </div>
    </div>
  );
}
