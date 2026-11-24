// Shared integration-test harness: throw-away embedded database, real HTTP server on a random port.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ieomms-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = 'Admin@2026x';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.NOTIFICATIONS = 'off'; // tests trigger the engine explicitly
process.env.SEED_DEMO_LIFECYCLE = 'off';
process.env.BACKUPS = 'off';
export const appModule = () => import('../index.ts');
delete process.env.SMTP_URL;
delete process.env.DATABASE_URL;

const { start } = await import('../index.ts');
export const { db } = await import('../db/index.ts');
const demo = await import('../scripts/seed-demo.ts');
export const DEMO_PASSWORD = demo.DEMO_PASSWORD;

let server: Server;
let base = '';
export const ctx = { projectId: 0, tradeId: 0 };

export class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown, raw?: FormData) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer() } as { status: number; body: any };
  }
  async login(username: string, password = DEMO_PASSWORD) {
    const r = await this.req('POST', '/api/auth/login', { username, password });
    assert.equal(r.status, 200, `login ${username}: ${JSON.stringify(r.body)}`);
    return this;
  }
}
export const login = (u: string, p?: string) => new Client().login(u, p);

export const validCandidate = (over: Record<string, unknown> = {}) => ({
  full_name: 'Test Candidate One', gender: 'male', date_of_birth: '1990-04-12', nationality: 'India', marital_status: 'married',
  contact_number: '+91 98470 12345', email: 'test.one@mail.example',
  passport_number: `T${Math.floor(Math.random() * 1e7)}`, passport_issue_date: '2020-01-10', passport_expiry_date: '2030-01-09',
  passport_issuing_country: 'India', position: 'Scaffolder', trade_id: ctx.tradeId, project_id: ctx.projectId, employment_category: 'labour',
  basic_salary: '1800', housing_allowance: '0', transport_allowance: '300', food_allowance: '200', other_allowance: '0',
  contract_status: 'not_prepared', offer_letter_status: 'issued', selection_date: '2026-10-01', expected_joining_date: '2026-12-15',
  ...over,
});

export const pdf = () => new TextEncoder().encode('%PDF-1.4\n%test\n');

// Started at import time (top-level await) so it is ready before any test file's own hooks run.
server = await start(0);
base = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.IEOMMS_TEST_BASE = base; // for tests that need raw fetch (headers, malformed bodies)
await demo.seedDemo();
ctx.projectId = (await db.one('SELECT id FROM projects ORDER BY id LIMIT 1'))!.id;
ctx.tradeId = (await db.one("SELECT id FROM trades WHERE code = 'SCF'"))!.id;

after(async () => {
  server.closeAllConnections();
  server.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
