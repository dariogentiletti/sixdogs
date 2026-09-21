import { readFile } from 'node:fs/promises';

// Two database modes:
//  - DATABASE_URL set   -> a real Postgres server (the Docker / VPS setup)
//  - DATABASE_URL unset -> PGlite: Postgres compiled to run inside Node, storing
//                          its files in DATA_DIR (default ./data). Nothing to install.
// Both expose the same small interface: query(), connect() -> {query, release}, end().

/**
 * Is this running somewhere the local disk disappears on every deploy?
 * Railway, Fly, Heroku and friends all rebuild the container, so the built-in
 * database would silently lose every link each time. Detected by the variables
 * those platforms set for you.
 */
export function looksEphemeral(env = process.env) {
  return Boolean(
    env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID
    || env.FLY_APP_NAME || env.DYNO || env.RENDER || env.K_SERVICE,
  );
}

export async function createPool(databaseUrl, dataDir, { log = console, env = process.env } = {}) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    pool.on('error', (err) => log.error('[db] idle client error:', err.message));
    // Host only, never the credentials in the rest of the URL.
    let where = 'a Postgres server';
    try { where = new URL(databaseUrl).host; } catch { /* keep the generic wording */ }
    log.log(`[db] using Postgres at ${where}. Links and ratings survive restarts and deploys.`);
    pool.kind = 'postgres';
    pool.where = where;
    return pool;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  const adapter = new PgliteAdapter(db);
  adapter.kind = 'pglite';
  adapter.where = dataDir;
  if (looksEphemeral(env)) {
    // Loud on purpose. Everyone would have to verify again after the next push.
    log.error('');
    log.error('  ############################################################');
    log.error('  #  DATABASE_URL is not set, so SIXDOGS is using the        #');
    log.error('  #  built-in database inside this container.                #');
    log.error('  #                                                          #');
    log.error('  #  This host replaces the container on every deploy, so    #');
    log.error('  #  EVERY VERIFIED PLAYER WILL BE LOST the next time you    #');
    log.error('  #  push a change, and everyone has to /verify again.       #');
    log.error('  #                                                          #');
    log.error('  #  Fix: add a Postgres database in your host and set       #');
    log.error('  #  DATABASE_URL to it. See deploy/RAILWAY.md step 3.       #');
    log.error('  ############################################################');
    log.error('');
  } else {
    log.log(`[db] using the built-in database in ${dataDir}`);
  }
  return adapter;
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
