// Phase 5: management reports, exports and backups.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { db, login } from './harness.ts';

const KEYS = ['onboarding_register', 'candidate_selection', 'international_travel', 'airport_pickup', 'accommodation_allocation', 'medical_status', 'visa_processing',
  'training_completion', 'uniform_ppe', 'department_pending', 'overdue_activities', 'deployment_readiness', 'mobilisation_cost', 'project_onboarding'];

describe('management reports', () => {
  test('all 14 reports run for management and return data', async () => {
    const ceo = await login('ceo');
    const list = (await ceo.req('GET', '/api/reports')).body;
    assert.deepEqual(list.map((r: any) => r.key).sort(), [...KEYS].sort());
    for (const k of KEYS) {
      const r = await ceo.req('GET', `/api/reports/${k}`);
      assert.equal(r.status, 200, `${k}: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.rows) && r.body.columns.length > 3, k);
      if (!['mobilisation_cost'].includes(k)) assert.ok(r.body.total > 0, `${k} has rows`);
    }
  });

  test('filters narrow results, are described, and bad input is rejected', async () => {
    const hr = await login('hr.manager');
    const all = (await hr.req('GET', '/api/reports/onboarding_register')).body;
    const proj = await db.one(`SELECT id, name FROM projects WHERE code = 'RUW-24'`);
    const one = (await hr.req('GET', `/api/reports/onboarding_register?project_id=${proj!.id}&nationality=India`)).body;
    assert.ok(one.total < all.total && one.total > 0);
    assert.ok(one.rows.every((r: any) => r.project === proj!.name && r.nationality === 'India'));
    assert.match(one.filters, /Project: Ruwais/);
    const st = (await hr.req('GET', '/api/reports/onboarding_register?status=onboarding,arrived')).body;
    assert.ok(st.rows.every((r: any) => ['onboarding', 'arrived'].includes(r.status)));
    const dated = (await hr.req('GET', '/api/reports/candidate_selection?from=2099-01-01')).body;
    assert.equal(dated.total, 0);
    assert.equal((await hr.req('GET', '/api/reports/candidate_selection?from=2026-13-01')).status, 400);
    assert.equal((await hr.req('GET', '/api/reports/candidate_selection?from=2026-12-01&to=2026-01-01')).status, 400);
    assert.equal((await hr.req('GET', '/api/reports/nope')).status, 404);
  });

  test('access: costs only for finance; departments see only their own activities', async () => {
    const ops = await login('operations');
    assert.equal((await ops.req('GET', '/api/reports/mobilisation_cost')).status, 403);
    const proj = (await ops.req('GET', '/api/reports/project_onboarding')).body;
    assert.ok(proj.columns.every((c: any) => c[0] !== 'cost'));
    const fin = await login('finance');
    assert.equal((await fin.req('GET', '/api/reports/mobilisation_cost')).status, 200);
    const pro = await login('pro');
    const pend = (await pro.req('GET', '/api/reports/department_pending')).body;
    assert.ok(pend.total > 0 && pend.rows.every((r: any) => r.department === 'PRO / Government Relations'));
    assert.equal((await pro.req('GET', '/api/reports/onboarding_register')).status, 403);
    assert.ok(!(await pro.req('GET', '/api/reports')).body.some((r: any) => r.key === 'mobilisation_cost'));
  });

  test('Excel and PDF exports are real files with header, data and totals, and are audited', async () => {
    const fin = await login('finance');
    const x = await fin.req('GET', '/api/reports/mobilisation_cost?format=xlsx');
    assert.equal(x.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.worksheets[0];
    assert.match(String(ws.getCell('A2').value), /Mobilisation cost report/);
    assert.equal(ws.getCell('A6').value, 'Employee');
    const last = ws.getRow(ws.rowCount);
    assert.equal(last.getCell(1).value, 'Total');
    const p = await fin.req('GET', '/api/reports/mobilisation_cost?format=pdf');
    assert.equal(p.status, 200);
    const head = Buffer.from(p.body).subarray(0, 5).toString();
    assert.equal(head, '%PDF-');
    assert.ok(Buffer.from(p.body).length > 2000);
    assert.equal((await fin.req('GET', '/api/reports/mobilisation_cost?format=csv')).status, 400);
    const a = await db.one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'export' AND entity = 'reports'`);
    assert.ok(a!.n >= 2);
    // A wide landscape report renders too
    assert.equal((await (await login('hr.manager')).req('GET', '/api/reports/deployment_readiness?format=pdf')).status, 200);
  });
});

describe('backups', () => {
  test('administrator can run and list backups; others cannot', async () => {
    const admin = await login('admin', 'Admin@2026x');
    const r = await admin.req('POST', '/api/admin/backups');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'ok');
    assert.ok(r.body.database_bytes > 1000);
    const list = (await admin.req('GET', '/api/admin/backups')).body.backups;
    assert.ok(list.some((b: any) => b.name === r.body.name));
    assert.equal((await (await login('hr.manager')).req('POST', '/api/admin/backups')).status, 403);
  });
});
