// Bulk candidate import from Excel: template download, dry-run validation, then commit.
import express from 'express';
import ExcelJS from 'exceljs';
import { db } from '../db/index.ts';
import { AppError, asyncH, badRequest } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can } from '../lib/rbac.ts';
import { audit } from '../lib/audit.ts';
import { ENUMS, COUNTRIES } from '../lib/enums.ts';
import { createCandidate, SALARY_FIELDS } from './candidates.ts';
import { upload } from './documents.ts';
import { styleHeader } from '../lib/xlsx.ts';

type ColDef = { key: string; header: string; required?: boolean; kind?: 'date' | 'enum' | 'ref' | 'bool'; list?: string; note?: string };

const COLUMNS: ColDef[] = [
  { key: 'full_name', header: 'Full Name (as per passport)', required: true },
  { key: 'gender', header: 'Gender', required: true, kind: 'enum', list: 'gender' },
  { key: 'date_of_birth', header: 'Date of Birth', required: true, kind: 'date' },
  { key: 'nationality', header: 'Nationality', required: true },
  { key: 'marital_status', header: 'Marital Status', kind: 'enum', list: 'marital_status' },
  { key: 'contact_number', header: 'Contact Number' },
  { key: 'email', header: 'Email' },
  { key: 'current_address', header: 'Current Address' },
  { key: 'emergency_contact_name', header: 'Emergency Contact Name' },
  { key: 'emergency_contact_relation', header: 'Emergency Contact Relation' },
  { key: 'emergency_contact_phone', header: 'Emergency Contact Phone' },
  { key: 'passport_number', header: 'Passport Number', required: true },
  { key: 'passport_issue_date', header: 'Passport Issue Date', required: true, kind: 'date' },
  { key: 'passport_expiry_date', header: 'Passport Expiry Date', required: true, kind: 'date' },
  { key: 'passport_issuing_country', header: 'Passport Issuing Country', required: true },
  { key: 'position', header: 'Position / Designation', required: true },
  { key: 'trade_id', header: 'Trade', required: true, kind: 'ref', list: 'trades' },
  { key: 'department_id', header: 'Department', kind: 'ref', list: 'departments' },
  { key: 'project_id', header: 'Project Code', required: true, kind: 'ref', list: 'projects' },
  { key: 'work_location', header: 'Work Location' },
  { key: 'employment_category', header: 'Employment Category', required: true, kind: 'enum', list: 'employment_category' },
  { key: 'basic_salary', header: 'Basic Salary (AED)' },
  { key: 'housing_allowance', header: 'Housing Allowance' },
  { key: 'transport_allowance', header: 'Transport Allowance' },
  { key: 'food_allowance', header: 'Food Allowance' },
  { key: 'other_allowance', header: 'Other Allowance' },
  { key: 'contract_status', header: 'Contract Status', kind: 'enum', list: 'contract_status' },
  { key: 'offer_letter_status', header: 'Offer Letter Status', kind: 'enum', list: 'offer_letter_status' },
  { key: 'selection_date', header: 'Selection Date', required: true, kind: 'date' },
  { key: 'expected_joining_date', header: 'Expected Joining Date', kind: 'date' },
  { key: 'recruitment_agency_id', header: 'Recruitment Agency', kind: 'ref', list: 'agencies' },
  { key: 'source_country', header: 'Source Country' },
  { key: 'educational_qualifications', header: 'Educational Qualifications' },
  { key: 'professional_qualifications', header: 'Professional Qualifications' },
  { key: 'work_experience', header: 'Work Experience' },
  { key: 'licences_certifications', header: 'Licences / Certifications' },
  { key: 'previous_uae_experience', header: 'Previous UAE Experience (Yes/No)', kind: 'bool' },
  { key: 'remarks', header: 'Remarks' },
];

async function lookups() {
  const [trades, departments, projects, agencies] = await Promise.all([
    db.many('SELECT id, name AS k FROM trades WHERE is_active ORDER BY name'),
    db.many('SELECT id, name AS k FROM departments WHERE is_active ORDER BY name'),
    db.many('SELECT id, code AS k FROM projects WHERE is_active ORDER BY code'),
    db.many('SELECT id, name AS k FROM recruitment_agencies WHERE is_active ORDER BY name'),
  ]);
  return { trades, departments, projects, agencies } as unknown as Record<string, { id: number; k: string }[]>;
}

const cols = (salary: boolean) => COLUMNS.filter((c) => salary || !SALARY_FIELDS.includes(c.key));

export const importsRouter = express.Router();

importsRouter.get('/imports/candidates/template', requirePerm('candidates.import'), asyncH(async (req, res) => {
  const L = await lookups();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Candidates');
  const lists = wb.addWorksheet('Lists');
  const columns = cols(can(req.user, 'candidates.salary'));
  styleHeader(ws.addRow(columns.map((c) => (c.required ? `${c.header} *` : c.header))));
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, c.header.length + 2); });
  // Lists sheet with every valid value; data validation dropdowns point at it.
  const listCols: [string, string[]][] = [
    ['Trades', L.trades.map((x) => x.k)], ['Departments', L.departments.map((x) => x.k)], ['Project Codes', L.projects.map((x) => x.k)],
    ['Recruitment Agencies', L.agencies.map((x) => x.k)], ['Countries', COUNTRIES],
    ...(['gender', 'marital_status', 'employment_category', 'contract_status', 'offer_letter_status'].map((k) => [k, ENUMS[k].map((o) => o.label)]) as [string, string[]][]),
    ['Yes/No', ['Yes', 'No']],
  ];
  styleHeader(lists.addRow(listCols.map((l) => l[0])));
  const maxLen = Math.max(...listCols.map((l) => l[1].length));
  for (let i = 0; i < maxLen; i++) lists.addRow(listCols.map((l) => l[1][i] ?? null));
  listCols.forEach((_, i) => { lists.getColumn(i + 1).width = 24; });
  const ref = (name: string) => {
    const idx = listCols.findIndex((l) => l[0] === name);
    const letter = String.fromCharCode(65 + idx);
    return `Lists!$${letter}$2:$${letter}$${Math.max(2, listCols[idx][1].length + 1)}`;
  };
  const listFor: Record<string, string> = { trades: 'Trades', departments: 'Departments', projects: 'Project Codes', agencies: 'Recruitment Agencies' };
  columns.forEach((c, i) => {
    let formula: string | null = null;
    if (c.kind === 'ref') formula = ref(listFor[c.list!]);
    else if (c.kind === 'enum') formula = ref(c.list!);
    else if (c.kind === 'bool') formula = ref('Yes/No');
    else if (['nationality', 'passport_issuing_country', 'source_country'].includes(c.key)) formula = ref('Countries');
    for (let r = 2; r <= 500; r++) {
      const cell = ws.getCell(r, i + 1);
      if (formula) cell.dataValidation = { type: 'list', allowBlank: !c.required, formulae: [formula] };
      if (c.kind === 'date') cell.numFmt = 'yyyy-mm-dd';
    }
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="IEOMMS_candidate_import_template.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && v.text != null) return String(v.text);
    if ('result' in v && v.result != null) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v).trim();
}

function normDate(s: string) {
  if (!s) return s;
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy (UAE convention)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

async function parse(buffer: Buffer, salary: boolean) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as any); } catch { throw badRequest('The file could not be read. Upload the .xlsx template.'); }
  const ws = wb.getWorksheet('Candidates') || wb.worksheets[0];
  if (!ws) throw badRequest('The workbook has no worksheet.');
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => cellText(v).replace(/\s*\*$/, '').toLowerCase());
  const columns = cols(salary);
  const index: Record<string, number> = {};
  for (const c of columns) {
    const i = header.indexOf(c.header.toLowerCase());
    if (i >= 0) index[c.key] = i + 1;
  }
  const missing = columns.filter((c) => c.required && !index[c.key]).map((c) => c.header);
  if (missing.length) throw badRequest(`Required columns are missing: ${missing.join(', ')}. Please use the download template.`);
  const L = await lookups();
  const listFor: Record<string, string> = { trade_id: 'trades', department_id: 'departments', project_id: 'projects', recruitment_agency_id: 'agencies' };
  const rows: { row: number; data: Record<string, unknown>; errors: Record<string, string> }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const data: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    let any = false;
    for (const c of columns) {
      if (!index[c.key]) continue;
      let s = cellText(r.getCell(index[c.key]).value);
      if (s) any = true;
      if (!s) { data[c.key] = ''; continue; }
      if (c.kind === 'date') s = normDate(s);
      if (c.kind === 'enum') {
        const o = ENUMS[c.list!].find((x) => x.label.toLowerCase() === s.toLowerCase() || x.value === s.toLowerCase());
        if (!o) errors[c.key] = `"${s}" is not a valid ${c.header.toLowerCase()}.`; else s = o.value;
      }
      if (c.kind === 'ref') {
        const hit = L[listFor[c.key]].find((x) => x.k.toLowerCase() === s.toLowerCase());
        if (!hit) { errors[c.key] = `"${s}" is not an active ${c.header.toLowerCase()}.`; continue; }
        data[c.key] = hit.id;
        continue;
      }
      data[c.key] = s;
    }
    if (!any) return;
    if (!data.contract_status) data.contract_status = 'not_prepared';
    if (!data.offer_letter_status) data.offer_letter_status = 'not_issued';
    rows.push({ row: n, data, errors });
  });
  if (!rows.length) throw badRequest('No candidate rows were found in the file.');
  if (rows.length > 1000) throw badRequest('Import at most 1,000 candidates per file.');
  return rows;
}

const headerOf = (key: string) => COLUMNS.find((c) => c.key === key)?.header || key;

importsRouter.post('/imports/candidates', requirePerm('candidates.import'), requirePerm('candidates.create'), upload.single('file'), asyncH(async (req, res) => {
  if (!req.file) throw badRequest('Choose an Excel (.xlsx) file to import.');
  if (!/\.xlsx$/i.test(req.file.originalname)) throw badRequest('Only .xlsx files can be imported.');
  const dryRun = req.query.dryRun === '1';
  const rows = await parse(req.file.buffer, can(req.user, 'candidates.salary'));
  const seen = new Map<string, number>();
  const results: { row: number; name: string; ok: boolean; errors: string[]; warnings: string[]; reference_no?: string }[] = [];
  let created = 0;
  // Each row runs in its own transaction so one bad row never blocks the others.
  for (const r of rows) {
    const name = String(r.data.full_name || '');
    const errs = Object.entries(r.errors).map(([k, m]) => `${headerOf(k)}: ${m}`);
    const pp = `${String(r.data.passport_number || '').toUpperCase()}|${r.data.passport_issuing_country}`;
    if (r.data.passport_number && seen.has(pp)) errs.push(`Passport Number: duplicate of row ${seen.get(pp)} in this file.`);
    else if (r.data.passport_number) seen.set(pp, r.row);
    if (errs.length) { results.push({ row: r.row, name, ok: false, errors: errs, warnings: [] }); continue; }
    try {
      const out = await db.tx(async (q) => {
        const o = await createCandidate(req, q, r.data);
        if (dryRun) throw Object.assign(new Error('dry-run'), { dryRunResult: o });
        return o;
      });
      created++;
      results.push({ row: r.row, name, ok: true, errors: [], warnings: out.warnings, reference_no: out.row.reference_no });
    } catch (e: any) {
      if (e?.dryRunResult) { results.push({ row: r.row, name, ok: true, errors: [], warnings: e.dryRunResult.warnings }); continue; }
      if (e instanceof AppError) {
        const details = e.details ? Object.entries(e.details).map(([k, m]) => `${headerOf(k)}: ${m}`) : [e.message];
        results.push({ row: r.row, name, ok: false, errors: details, warnings: [] });
      } else throw e;
    }
  }
  // Dry runs roll back each row's transaction, including the reference counter, so no numbers are consumed.
  if (!dryRun) await audit(db, req, 'import', 'candidates', null, null, { file: req.file.originalname, rows: rows.length, created });
  res.json({ dryRun, total: rows.length, valid: results.filter((x) => x.ok).length, created, results });
}));
