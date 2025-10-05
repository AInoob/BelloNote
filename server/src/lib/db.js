import { Pool } from 'pg'

const DEFAULT_DATABASE = process.env.PGDATABASE || process.env.DB_NAME || 'bello_note'

const poolConfig = (() => {
  if (process.env.DATABASE_URL) {
    const config = { connectionString: process.env.DATABASE_URL }
    if ((process.env.PGSSLMODE || '').toLowerCase() === 'require') {
      config.ssl = { rejectUnauthorized: false }
    }
    return config
  }
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number.parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: DEFAULT_DATABASE,
    ssl: (process.env.PGSSLMODE || '').toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : undefined
  }
})()

export const pool = new Pool(poolConfig)

pool.on('error', (err) => {
  console.error('[db] unexpected error', err)
})

function createDbClient(executor) {
  return {
    query: (text, params = []) => executor.query(text, params),
    async get(text, params = []) {
      const res = await executor.query(text, params)
      return res.rows[0] || null
    },
    async all(text, params = []) {
      const res = await executor.query(text, params)
      return res.rows
    },
    async run(text, params = []) {
      const res = await executor.query(text, params)
      return res
    }
  }
}

export const db = createDbClient(pool)

export async function transaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const proxy = createDbClient(client)
    const result = await callback(proxy)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackErr) {
      console.error('[db] rollback error', rollbackErr)
    }
    throw err
  } finally {
    client.release()
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS projects (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id UUID PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
     title TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'todo',
     content TEXT NOT NULL DEFAULT '',
     tags JSONB NOT NULL DEFAULT '[]'::jsonb,
     worked_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
     first_work_date DATE,
     last_work_date DATE,
     position INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );`,
  `CREATE TABLE IF NOT EXISTS outline_versions (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     cause TEXT NOT NULL DEFAULT 'autosave',
     parent_id INTEGER REFERENCES outline_versions(id) ON DELETE SET NULL,
     hash TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     meta JSONB NOT NULL DEFAULT '{}'::jsonb,
     doc_json JSONB NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS files (
     id SERIAL PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     stored_name TEXT NOT NULL,
     original_name TEXT,
     mime_type TEXT NOT NULL,
     size_bytes BIGINT NOT NULL,
     hash TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_hash ON files(hash);`,
  `CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id, id DESC);`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS worked_dates JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS first_work_date DATE;`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_work_date DATE;`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(project_id, parent_id, position, id);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_first_work_date ON tasks(first_work_date);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_last_work_date ON tasks(last_work_date);`,
  `CREATE INDEX IF NOT EXISTS idx_versions_project ON outline_versions(project_id, id DESC);`
]

async function initSchema() {
  const client = await pool.connect()
  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await client.query(statement)
    }
    await client.query(`
      DO $func$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_views
          WHERE schemaname = current_schema()
            AND viewname = 'work_logs'
        ) THEN
          EXECUTE 'DROP VIEW work_logs';
        ELSIF EXISTS (
          SELECT 1
          FROM pg_tables
          WHERE schemaname = current_schema()
            AND tablename = 'work_logs'
        ) THEN
          EXECUTE 'DROP TABLE work_logs CASCADE';
        END IF;
      END
      $func$;
    `)
    await client.query(`
      CREATE OR REPLACE VIEW work_logs AS
      SELECT
        t.id::uuid              AS task_id,
        (d.value)::date         AS date
      FROM tasks t
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(t.worked_dates, '[]'::jsonb)) AS d(value);
    `)
  } finally {
    client.release()
  }
}

await initSchema()
