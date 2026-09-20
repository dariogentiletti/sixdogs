import { readFile } from 'node:fs/promises';

// Two database modes:
//  - DATABASE_URL set   -> a real Postgres server (the Docker / VPS setup)
//  - DATABASE_URL unset -> PGlite: Postgres compiled to run inside Node, storing
//                          its files in DATA_DIR (default ./data). Nothing to install.
// Both expose the same small interface: query(), connect() -> {query, release}, end().

export async function createPool(databaseUrl, dataDir) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
    return pool;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  console.log(`[db] using built-in database in ${dataDir}`);
  return new PgliteAdapter(db);
}

// PGlite is a single connection, so transactions must not interleave with
// other queries. A simple lock serialises them.
class PgliteAdapter {
  constructor(db) {
    this.db = db;
    this.lock = Promise.resolve();
  }

  async run(sql, params) {
    const r = await this.db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }

  async query(sql, params) {
    const prev = this.lock;
    let done;
    this.lock = new Promise((r) => { done = r; });
    await prev;
    try { return await this.run(sql, params); } finally { done(); }
  }

  async exec(sql) {
    await this.lock;
    return this.db.exec(sql);
  }

  async connect() {
    const prev = this.lock;
    let done;
    this.lock = new Promise((r) => { done = r; });
    await prev;
    return {
      query: (sql, params) => this.run(sql, params),
      release: () => done(),
    };
  }

  end() { return this.db.close(); }
}

export async function migrate(pool) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  if (typeof pool.exec === 'function') return pool.exec(sql);
  // Postgres may still be starting when docker compose launches us; retry a bit.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`[db] waiting for Postgres (${err.code || err.message})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
