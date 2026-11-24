// Seeds the role/permission catalogue, departments and the first administrator. Idempotent.
import crypto from 'node:crypto';
import { db } from './index.ts';
import { config } from '../config.ts';
import { DEPARTMENTS, PERMISSIONS, ROLES } from '../lib/rbac.ts';
import { hashPassword } from '../lib/auth.ts';
import { ACTIVITY_CATALOGUE, DEFAULT_COURSES, DEFAULT_UNIFORM_ITEMS } from '../lib/catalogue.ts';

export async function bootstrap(opts: { adminPassword?: string; quiet?: boolean } = {}) {
  await db.tx(async (q) => {
    for (const [code, p] of Object.entries(PERMISSIONS)) {
      await q.query(`INSERT INTO permissions(code, module, description) VALUES ($1,$2,$3)
        ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`, [code, p.module, p.description]);
    }
    // Each default grant is applied once. Grants added by later releases reach existing databases,
    // while a permission an administrator later removed is not put back.
    await q.query(`CREATE TABLE IF NOT EXISTS rbac_grants_applied (role_code VARCHAR(40), permission_code VARCHAR(60), PRIMARY KEY (role_code, permission_code))`);
    for (const [code, r] of Object.entries(ROLES)) {
      let role = (await q.query('SELECT id FROM roles WHERE code = $1', [code])).rows[0];
      if (!role) role = (await q.query('INSERT INTO roles(code, name, description) VALUES ($1,$2,$3) RETURNING id', [code, r.name, r.description])).rows[0];
      const fresh = (await q.query(`SELECT unnest($1::text[]) AS p EXCEPT SELECT permission_code FROM rbac_grants_applied WHERE role_code = $2`, [r.permissions, code])).rows.map((x) => x.p);
      if (!fresh.length) continue;
      await q.query(`INSERT INTO role_permissions(role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ON CONFLICT DO NOTHING`, [role.id, fresh]);
      await q.query(`INSERT INTO rbac_grants_applied(role_code, permission_code) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [code, fresh]);
    }
    // Super administrator always holds every permission, including ones added by later releases.
    await q.query(`INSERT INTO role_permissions(role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'super_admin' ON CONFLICT DO NOTHING`);
    for (const [code, name] of DEPARTMENTS) {
      await q.query('INSERT INTO departments(code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING', [code, name]);
    }
    // Phase 3 catalogue: inserted once (by sequence), then owned by the administrator.
    for (const [seq, section, name, dept, mandatory, doc, verify, anchor, offset, workflow] of ACTIVITY_CATALOGUE) {
      await q.query(`INSERT INTO onboarding_activity_definitions(seq, section, name, department_id, is_mandatory, requires_document, document_category,
          requires_verification, anchor, offset_days, workflow_key, is_system)
        SELECT $1,$2,$3,d.id,$4,$5,$6,$7,$8,$9,$10,TRUE FROM departments d WHERE d.code = $11 ON CONFLICT (seq) DO NOTHING`,
      [seq, section, name, mandatory, !!doc, doc, verify, anchor, offset, workflow, dept]);
    }
    if (!(await q.query('SELECT 1 FROM training_courses LIMIT 1')).rows.length) {
      for (const [code, name, category, hours, validity] of DEFAULT_COURSES) {
        await q.query('INSERT INTO training_courses(code, name, category, duration_hours, validity_months) VALUES ($1,$2,$3,$4,$5)', [code, name, category, hours, validity]);
      }
    }
    if (!(await q.query('SELECT 1 FROM uniform_items LIMIT 1')).rows.length) {
      for (const [name, category, size, qty] of DEFAULT_UNIFORM_ITEMS) {
        await q.query('INSERT INTO uniform_items(name, category, needs_size, default_qty) VALUES ($1,$2,$3,$4)', [name, category, size, qty]);
      }
    }
    if (!(await q.query('SELECT 1 FROM onboarding_templates LIMIT 1')).rows.length) {
      await q.query(`INSERT INTO onboarding_templates(name, description) VALUES ('Standard onboarding', 'Default template: all 48 activities apply unless a trade or project template says otherwise.')`);
    }
  });

  const count = await db.one<{ n: number }>('SELECT count(*)::int AS n FROM users');
  if (count!.n === 0) {
    const generated = !(opts.adminPassword || config.adminPassword);
    const password = opts.adminPassword || config.adminPassword || `Ieo-${crypto.randomBytes(6).toString('base64url')}9a`;
    await db.query(`INSERT INTO users(username, full_name, password_hash, role_id, must_change_password)
      SELECT $1, 'System Administrator', $2, id, $3 FROM roles WHERE code = 'super_admin'`,
      [config.adminUsername, await hashPassword(password), generated]);
    if (!opts.quiet) {
      console.log('\n================================================================');
      console.log(` Initial administrator created:  ${config.adminUsername} / ${password}`);
      console.log(generated ? ' You will be asked to change this password at first sign-in.' : '');
      console.log('================================================================\n');
    }
  }
}
