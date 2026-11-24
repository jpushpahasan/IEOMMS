// Database access layer.
// - DATABASE_URL set  -> PostgreSQL server through node-postgres (production).
// - otherwise         -> embedded PostgreSQL (PGlite) persisted in data/pgdata.
// Both expose the same API so the rest of the code never knows which one is in use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';

export type Row = Record<string, any>;
export interface Q { query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }> }
interface Impl extends Q {
  kind: 'postgresql' | 'pglite';
  exec: (sql: string) => Promise<unknown>;
  tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
  /** Embedded database only: compressed copy of the data directory, taken between queries. */
  dump?: () => Promise<Buffer>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
let impl: Impl | null = null;
const OID = { NUMERIC: 1700, DATE: 1082, INT8: 20, TIMESTAMP: 1114 }; // TIMESTAMP (no zone) = local wall-clock time, kept as text

async function initPg(): Promise<Impl> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(OID.NUMERIC, (v: string) => v);
  pg.types.setTypeParser(OID.DATE, (v: string) => v);
  pg.types.setTypeParser(OID.TIMESTAMP, (v: string) => v);
  pg.types.setTypeParser(OID.INT8, (v: string) => (v === null ? null : Number(v)));
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined });
  pool.on('connect', (c) => { c.query("SET TIME ZONE 'Asia/Dubai'"); });
  return {
    kind: 'postgresql',
    query: (sql, params = []) => pool.query(sql, params as any[]),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (s, p = []) => client.query(s, p as any[]) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function initPglite(dir: string): Promise<Impl> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, {
    parsers: {
      [types.NUMERIC]: (v: string) => v,
      [types.DATE]: (v: string) => v,
      [types.TIMESTAMP]: (v: string) => v,
      [types.INT8]: (v: string) => (v === null ? null : Number(v)),
    },
  });
  await db.waitReady;
  await db.exec("SET TIME ZONE 'Asia/Dubai'");
  // PGlite is a single connection: serialise all work so transactions never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  return {
    kind: 'pglite',
    query: (sql, params = []) => serial(() => db.query<Row>(sql, params as any[])),
    exec: (sql) => serial(() => db.exec(sql)),
    tx: (fn) => serial(() => db.transaction((t) => fn({ query: (s, p = []) => t.query<Row>(s, p as any[]) }))),
    close: () => db.close(),
    dump: () => serial(async () => Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer())),
  };
}

export async function initDb(opts: { pgliteDir?: string } = {}) {
  if (impl) return impl;
  impl = config.databaseUrl ? await initPg() : await initPglite(opts.pgliteDir || config.pgliteDir);
  await impl.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return impl;
}

function need(): Impl {
  if (!impl) throw new Error('Database not initialised');
  return impl;
}

export const db = {
  get kind() { return impl?.kind; },
  query: (sql: string, params?: unknown[]) => need().query(sql, params),
  async one<T = Row>(sql: string, params?: unknown[]): Promise<T | null> { return ((await need().query(sql, params)).rows[0] as T) || null; },
  async many<T = Row>(sql: string, params?: unknown[]): Promise<T[]> { return (await need().query(sql, params)).rows as T[]; },
  tx: <T>(fn: (q: Q) => Promise<T>) => need().tx(fn),
  dump: () => need().dump?.() ?? Promise.resolve(null),
  async close() { if (impl) { await impl.close(); impl = null; } },
};

export const one = async (q: Q, sql: string, params?: unknown[]) => (await q.query(sql, params)).rows[0] || null;
