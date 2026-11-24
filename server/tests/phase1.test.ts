// Phase 1 integration tests: authentication, candidates, access control, lifecycle, import, documents.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, ctx, db, DEMO_PASSWORD, validCandidate } from './harness.ts';

const valid = () => validCandidate();
describe('authentication', () => {
  test('rejects bad credentials and unauthenticated access', async () => {
    const c = new Client();
    assert.equal((await c.req('POST', '/api/auth/login', { username: 'recruiter', password: 'wrong' })).status, 401);
    assert.equal((await c.req('GET', '/api/candidates')).status, 401);
  });
  test('locks the account after 5 failed attempts', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.req('POST', '/api/auth/login', { username: 'operations', password: 'nope' });
    assert.equal((await c.req('POST', '/api/auth/login', { username: 'operations', password: DEMO_PASSWORD })).status, 423);
    await db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = 'operations'");
  });
  test('administrator signs in with the configured initial password', async () => {
    const admin = await new Client().login('admin', 'Admin@2026x');
    const me = await admin.req('GET', '/api/auth/me');
    assert.equal(me.body.user.role, 'super_admin');
    assert.equal(me.body.user.must_change_password, false); // explicit ADMIN_PASSWORD -> no forced change
  });
});

describe('candidate registration', () => {
  test('recruiter creates a candidate with a unique reference number', async () => {
    const c = await new Client().login('recruiter');
    const a = await c.req('POST', '/api/candidates', valid());
    const b = await c.req('POST', '/api/candidates', { ...valid(), full_name: 'Test Candidate Two' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.match(a.body.reference_no, /^IEO-\d{4}-\d{5}$/);
    assert.notEqual(a.body.reference_no, b.body.reference_no);
    const got = await c.req('GET', `/api/candidates/${a.body.id}`);
    assert.equal(got.body.candidate.total_salary, '2300.00');
    assert.equal(got.body.history[0].to_status, 'selected');
  });
  test('validation returns every field error at once', async () => {
    const c = await new Client().login('recruiter');
    const r = await c.req('POST', '/api/candidates', { ...valid(), full_name: '', gender: 'x', passport_expiry_date: '2019-01-01', email: 'bad' });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.full_name && r.body.details.gender && r.body.details.email);
  });
  test('rejects under-age candidates and duplicate active passports', async () => {
    const c = await new Client().login('recruiter');
    assert.equal((await c.req('POST', '/api/candidates', { ...valid(), date_of_birth: '2012-01-01' })).status, 400);
    const p = valid();
    assert.equal((await c.req('POST', '/api/candidates', p)).status, 201);
    const dup = await c.req('POST', '/api/candidates', { ...p, passport_number: p.passport_number.toLowerCase() });
    assert.equal(dup.status, 409);
  });
  test('warns when passport validity is under 6 months from joining', async () => {
    const c = await new Client().login('recruiter');
    const r = await c.req('POST', '/api/candidates', { ...valid(), passport_expiry_date: '2027-02-01' });
    assert.equal(r.status, 201);
    assert.ok(r.body.warnings.some((w: string) => w.includes('Passport expires')));
  });
});

describe('access control', () => {
  test('mobility coordinator can view but not create, and cannot see salary', async () => {
    const c = await new Client().login('mobility');
    assert.equal((await c.req('POST', '/api/candidates', valid())).status, 403);
    const list = await c.req('GET', '/api/candidates?pageSize=5');
    assert.equal(list.status, 200);
    assert.ok(list.body.rows.length > 0);
    assert.equal(list.body.rows[0].basic_salary, undefined);
  });
  test('finance sees salary; recruiter cannot archive', async () => {
    const f = await new Client().login('finance');
    const list = await f.req('GET', '/api/candidates?pageSize=5');
    assert.notEqual(list.body.rows[0].basic_salary, undefined);
    const r = await new Client().login('recruiter');
    const id = list.body.rows[0].id;
    assert.equal((await r.req('POST', `/api/candidates/${id}/archive`, {})).status, 403);
  });
  test('only administrators manage users', async () => {
    assert.equal((await (await new Client().login('hr.manager')).req('GET', '/api/admin/users')).status, 403);
    assert.equal((await (await new Client().login('admin', 'Admin@2026x')).req('GET', '/api/admin/users')).status, 200);
  });
});

describe('lifecycle', () => {
  test('hold / resume restores the previous status; workflow statuses cannot be set by hand', async () => {
    const hr = await new Client().login('hr.manager');
    const { body } = await hr.req('POST', '/api/candidates', valid());
    const id = body.id;
    assert.equal((await hr.req('POST', `/api/candidates/${id}/status`, { action: 'pre_arrival' })).body.status, 'pre_arrival');
    assert.equal((await hr.req('POST', `/api/candidates/${id}/status`, { action: 'hold' })).status, 400); // reason required
    assert.equal((await hr.req('POST', `/api/candidates/${id}/status`, { action: 'hold', reason: 'Client freeze' })).body.status, 'on_hold');
    assert.equal((await hr.req('POST', `/api/candidates/${id}/status`, { action: 'resume' })).body.status, 'pre_arrival');
    assert.equal((await hr.req('POST', `/api/candidates/${id}/status`, { action: 'deployed' })).status, 400);
  });
  test('only cancelled candidates can be archived, and they are kept', async () => {
    const hr = await new Client().login('hr.manager');
    const { body } = await hr.req('POST', '/api/candidates', valid());
    assert.equal((await hr.req('POST', `/api/candidates/${body.id}/archive`, {})).status, 400);
    await hr.req('POST', `/api/candidates/${body.id}/status`, { action: 'cancel', reason: 'Withdrew', cancel_category: 'candidate_withdrew' });
    assert.equal((await hr.req('POST', `/api/candidates/${body.id}/archive`, {})).status, 200);
    const active = await hr.req('GET', `/api/candidates?q=${body.reference_no}`);
    assert.equal(active.body.total, 0);
    const archived = await hr.req('GET', `/api/candidates?archived=1&q=${body.reference_no}`);
    assert.equal(archived.body.total, 1);
  });
  test('edits are written to the audit log with changed fields only', async () => {
    const hr = await new Client().login('hr.manager');
    const { body } = await hr.req('POST', '/api/candidates', valid());
    assert.equal((await hr.req('PUT', `/api/candidates/${body.id}`, { position: 'Senior Scaffolder' })).status, 200);
    const log = await hr.req('GET', `/api/candidates/${body.id}/audit`);
    const upd = log.body.find((x: any) => x.action === 'update');
    assert.deepEqual(upd.new_values, { position: 'Senior Scaffolder', updated_by: upd.new_values.updated_by });
  });
});

describe('excel import', () => {
  test('template round-trip: dry run saves nothing, commit creates valid rows and reports bad ones', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const c = await new Client().login('recruiter');
    const tpl = await c.req('GET', '/api/imports/candidates/template');
    assert.equal(tpl.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const ws = wb.getWorksheet('Candidates')!;
    const headers = (ws.getRow(1).values as string[]).slice(1).map((h) => String(h).replace(/\s*\*$/, ''));
    const put = (row: number, vals: Record<string, string>) => headers.forEach((h, i) => { if (vals[h] !== undefined) ws.getCell(row, i + 1).value = vals[h]; });
    const base = { 'Gender': 'Male', 'Date of Birth': '12/04/1988', 'Nationality': 'Nepal', 'Passport Issue Date': '2021-01-01', 'Passport Expiry Date': '2031-01-01',
      'Passport Issuing Country': 'Nepal', 'Position / Designation': 'Rigger', 'Trade': 'Rigger', 'Project Code': 'RUW-24', 'Employment Category': 'Labour / Worker', 'Selection Date': '2026-09-01' };
    put(2, { ...base, 'Full Name (as per passport)': 'Import Good', 'Passport Number': 'NP7700112' });
    put(3, { ...base, 'Full Name (as per passport)': 'Import Bad', 'Passport Number': 'NP7700113', 'Trade': 'Astronaut' });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const send = (dry: boolean) => { const fd = new FormData(); fd.append('file', new Blob([buf]), 'list.xlsx'); return c.req('POST', `/api/imports/candidates${dry ? '?dryRun=1' : ''}`, undefined, fd); };
    const before = (await db.one('SELECT count(*)::int AS n FROM candidates'))!.n;
    const dry = await send(true);
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.valid, 1);
    assert.equal((await db.one('SELECT count(*)::int AS n FROM candidates'))!.n, before);
    const real = await send(false);
    assert.equal(real.body.created, 1);
    assert.ok(real.body.results.find((r: any) => !r.ok).errors[0].includes('Astronaut'));
    const row = await db.one("SELECT date_of_birth FROM candidates WHERE full_name = 'Import Good'");
    assert.equal(row!.date_of_birth, '1988-04-12'); // dd/mm/yyyy parsed UAE-style
  });
});

describe('documents', () => {
  test('accepts PDF by content, rejects disguised files, versions passports', async () => {
    const c = await new Client().login('recruiter');
    const { body } = await c.req('POST', '/api/candidates', valid());
    const up = (bytes: Uint8Array, name: string, category: string) => {
      const fd = new FormData();
      fd.append('category', category);
      fd.append('file', new Blob([bytes]), name);
      return c.req('POST', `/api/candidates/${body.id}/documents`, undefined, fd);
    };
    const pdf = new TextEncoder().encode('%PDF-1.4\n%test\n');
    assert.equal((await up(new TextEncoder().encode('MZ fake exe'), 'passport.pdf', 'passport')).status, 400);
    assert.equal((await up(pdf, 'passport.pdf', 'passport')).status, 201);
    const v2 = await up(pdf, 'passport-renewed.pdf', 'passport');
    assert.equal(v2.body.version, 2);
    const docs = await c.req('GET', `/api/candidates/${body.id}/documents`);
    assert.equal(docs.body.filter((d: any) => d.category === 'passport' && d.is_current).length, 1);
    const file = await c.req('GET', `/api/documents/${v2.body.id}/file`);
    assert.equal(file.status, 200);
    // finance role has documents.view; accommodation does not
    const acc = await new Client().login('accommodation');
    assert.equal((await acc.req('GET', `/api/documents/${v2.body.id}/file`)).status, 403);
  });
});
