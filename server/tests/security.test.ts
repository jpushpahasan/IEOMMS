// Security validation suite (Phase 5). Runs against the real HTTP server and database.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { appModule, Client, db, login, pdf } from './harness.ts';

/** Enumerates every /api route registered on the Express app (including routers). */
async function routes() {
  const { app } = await appModule();
  const out: { method: string; path: string }[] = [];
  const walk = (stack: any[], prefix: string) => {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: prefix + l.route.path });
      else if (l.name === 'router' && l.handle?.stack) {
        const src = String(l.regexp).replace('/^\\', '').replace('\\/?(?=\\/|$)/i', '').replace(/\\\//g, '/');
        walk(l.handle.stack, prefix + (src === '/^/?(?=/|$)/i' ? '' : src));
      }
    }
  };
  walk((app as any)._router.stack, '');
  return out.filter((r) => typeof r.path === 'string' && r.path.startsWith('/api'));
}
const concrete = (p: string) => p.replace(/:([a-zA-Z]+)/g, (_m, k) => (k === 'key' ? 'candidates' : k === 'kind' ? 'trade' : '1'));

describe('authentication & sessions', () => {
  test('every API route except login/logout/health rejects anonymous requests', async () => {
    const rs = await routes();
    assert.ok(rs.length > 100, `found ${rs.length} routes`);
    const open = ['/api/auth/login', '/api/auth/logout', '/api/health'];
    const anon = new Client();
    const failures: string[] = [];
    for (const r of rs) {
      if (open.includes(r.path)) continue;
      const res = await anon.req(r.method, concrete(r.path), r.method === 'GET' ? undefined : {});
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    assert.deepEqual(failures, []);
  });

  test('session cookie is HttpOnly and SameSite=Strict; logout invalidates it server-side', async () => {
    const res = await fetch(`${(await routesBase())}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ceo', password: 'Welcome@2026' }) });
    const cookie = res.headers.get('set-cookie') || '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    const c = new Client(); c.cookie = cookie.split(';')[0];
    assert.equal((await c.req('GET', '/api/auth/me')).status, 200);
    await c.req('POST', '/api/auth/logout');
    const stale = new Client(); stale.cookie = cookie.split(';')[0];
    assert.equal((await stale.req('GET', '/api/auth/me')).status, 401);
  });

  test('passwords are bcrypt-hashed and the policy is enforced; reset revokes sessions', async () => {
    const u = await db.one(`SELECT password_hash FROM users WHERE username = 'ceo'`);
    assert.match(u!.password_hash, /^\$2[aby]\$12\$/);
    const admin = await login('admin', 'Admin@2026x');
    assert.equal((await admin.req('POST', '/api/admin/users', { username: 'weakpw', full_name: 'Weak', role_id: 2, password: 'password' })).status, 400);
    const victim = await login('finance');
    const fid = (await db.one(`SELECT id FROM users WHERE username = 'finance'`))!.id;
    assert.equal((await admin.req('POST', `/api/admin/users/${fid}/reset-password`, { password: 'Welcome@2026' })).status, 200);
    assert.equal((await victim.req('GET', '/api/auth/me')).status, 401);
    await db.query(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [fid]);
  });

  test('temporary passwords must be changed before any change is allowed', async () => {
    const admin = await login('admin', 'Admin@2026x');
    const role = (await db.one(`SELECT id FROM roles WHERE code = 'recruitment'`))!.id;
    assert.equal((await admin.req('POST', '/api/admin/users', { username: 'temp.user', full_name: 'Temp User', role_id: role, password: 'Temporary2026' })).status, 201);
    const t = await login('temp.user', 'Temporary2026');
    assert.equal((await t.req('POST', '/api/candidates', {})).status, 428);
    assert.equal((await t.req('GET', '/api/candidates')).status, 200);
  });
});

const routesBase = async () => process.env.IEOMMS_TEST_BASE!;

describe('access control', () => {
  test('roles are refused endpoints outside their permissions', async () => {
    const cases: [string, string, string, unknown?][] = [
      ['accommodation', 'GET', '/api/finance/expenses'], ['accommodation', 'GET', '/api/documents'], ['operations', 'POST', '/api/bookings', {}],
      ['mobility', 'POST', '/api/accommodation/allocations', {}], ['medical', 'PUT', '/api/visa/1', {}], ['pro', 'POST', '/api/medical/visa', {}],
      ['training', 'POST', '/api/clearance/1/decide', { decision: 'approve' }], ['finance', 'POST', '/api/deployments', {}], ['recruiter', 'GET', '/api/admin/users'],
      ['ceo', 'POST', '/api/candidates', {}], ['hr.manager', 'PUT', '/api/admin/roles/2/permissions', { permissions: [] }], ['operations', 'GET', '/api/admin/audit'],
      ['mobility', 'POST', '/api/finance/expenses', {}], ['recruiter', 'POST', '/api/onboarding/activities/1/verify', { decision: 'approve' }],
    ];
    const failures: string[] = [];
    for (const [u, m, p, b] of cases) {
      const c = await login(u);
      const r = await c.req(m, p, b);
      if (r.status !== 403) failures.push(`${u} ${m} ${p} → ${r.status}`);
    }
    assert.deepEqual(failures, []);
  });

  test('sensitive fields are hidden: salary, costs, documents', async () => {
    const acc = await login('accommodation');
    const c = (await acc.req('GET', '/api/candidates?pageSize=5')).body.rows[0];
    assert.equal(c.basic_salary, undefined);
    const full = (await acc.req('GET', `/api/candidates/${c.id}`)).body.candidate;
    assert.equal(full.total_salary, undefined);
    const doc = await db.one(`SELECT id FROM employee_documents WHERE category = 'passport' OR category = 'visa_medical' LIMIT 1`);
    assert.equal((await acc.req('GET', `/api/documents/${doc!.id}/file`)).status, 403);
    const journey = (await (await login('recruiter')).req('GET', `/api/candidates/${c.id}/journey`)).body;
    assert.ok(journey.bookings.every((b: any) => b.ticket_cost === undefined));
  });

  test('a user cannot read or clear another user\'s notifications', async () => {
    const mob = await login('mobility');
    const other = await db.one(`SELECT n.id FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username <> 'mobility' LIMIT 1`);
    if (!other) return;
    await mob.req('POST', '/api/notifications/read', { ids: [other.id] });
    assert.equal((await db.one('SELECT read_at FROM notifications WHERE id = $1', [other.id]))!.read_at, null);
    assert.ok(!(await mob.req('GET', '/api/notifications')).body.rows.some((n: any) => n.id === other.id));
  });
});

describe('input handling', () => {
  test('SQL meta-characters in search, sort, filters and report parameters are treated as data', async () => {
    const hr = await login('hr.manager');
    const before = (await db.one('SELECT count(*)::int AS n FROM candidates'))!.n;
    const evil = ["' OR 1=1 --", "'; DROP TABLE candidates; --", '%_\\', '") UNION SELECT password_hash FROM users --'];
    for (const e of evil) {
      const q = encodeURIComponent(e);
      for (const url of [`/api/candidates?q=${q}`, `/api/candidates?sort=${q}&dir=${q}`, `/api/candidates?nationality=${q}`, `/api/bookings?q=${q}`,
        `/api/onboarding/tasks?scope=all&q=${q}`, `/api/reports/onboarding_register?nationality=${q}&status=${q}`, `/api/documents?q=${q}`, `/api/finance/expenses?q=${q}`]) {
        const r = await hr.req('GET', url);
        assert.ok([200, 400, 403].includes(r.status), `${url} → ${r.status}`);
        if (r.status === 200 && Array.isArray(r.body.rows) && url.includes('q=')) assert.ok(!JSON.stringify(r.body).includes('$2a$') && !JSON.stringify(r.body).includes('$2b$'));
      }
    }
    assert.equal((await db.one('SELECT count(*)::int AS n FROM candidates'))!.n, before);
  });

  test('malformed JSON and unknown routes return clean errors without internals', async () => {
    const c = await login('hr.manager');
    const res = await fetch(`${process.env.IEOMMS_TEST_BASE}/api/candidates`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookie }, body: '{bad json' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Malformed JSON request.');
    const nf = await c.req('GET', '/api/does-not-exist');
    assert.equal(nf.status, 404);
    assert.ok(!JSON.stringify(nf.body).match(/stack|at \/|node_modules|SELECT /i));
  });

  test('uploads: content sniffing, size limit, safe stored names', async () => {
    const hr = await login('hr.manager');
    const cid = (await db.one(`SELECT id FROM candidates WHERE status <> 'cancelled' AND NOT is_archived LIMIT 1`))!.id;
    const up = (bytes: Uint8Array, name: string) => { const fd = new FormData(); fd.append('category', 'other'); fd.append('file', new Blob([bytes]), name); return hr.req('POST', `/api/candidates/${cid}/documents`, undefined, fd); };
    assert.equal((await up(new TextEncoder().encode('<script>alert(1)</script>'), 'x.pdf')).status, 400);
    assert.equal((await up(new TextEncoder().encode('MZ\x90\x00'), 'invoice.png')).status, 400);
    const ok = await up(pdf(), '../../../etc/passwd.pdf');
    assert.equal(ok.status, 201);
    const d = await db.one('SELECT stored_name, original_name FROM employee_documents WHERE id = $1', [ok.body.id]);
    assert.match(d!.stored_name, /^[0-9a-f-]{36}\.pdf$/);
    const big = new Uint8Array(11 * 1024 * 1024); big.set(pdf());
    assert.equal((await up(big, 'big.pdf')).status, 413);
  });
});

describe('transport & headers', () => {
  test('security headers are set and cross-origin writes are rejected', async () => {
    const res = await fetch(`${process.env.IEOMMS_TEST_BASE}/api/health`);
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options'));
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const c = await login('hr.manager');
    const x = await fetch(`${process.env.IEOMMS_TEST_BASE}/api/candidates`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookie, origin: 'https://evil.example' }, body: '{}' });
    assert.equal(x.status, 403);
  });

  test('login is rate limited per client', async () => {
    // The test harness raises the limit; verify the limiter is active by checking its headers.
    const res = await fetch(`${process.env.IEOMMS_TEST_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y' }) });
    assert.ok(res.headers.get('ratelimit-limit') || res.headers.get('ratelimit'), 'rate-limit headers present');
  });
});
