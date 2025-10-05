#!/usr/bin/env node

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

import { Pool } from 'pg'
import initSqlJs from 'sql.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..')

const DEFAULT_SQLITE_PATH = path.join(repoRoot, 'server', 'data', 'tasks.db')

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
     position INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );`,
  `CREATE TABLE IF NOT EXISTS work_logs (
     id SERIAL PRIMARY KEY,
     task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     date DATE NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (task_id, date)
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
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(project_id, parent_id, position, id);`,
  `CREATE INDEX IF NOT EXISTS idx_worklogs_task ON work_logs(task_id);`,
  `CREATE INDEX IF NOT EXISTS idx_worklogs_date ON work_logs(date);`,
  `CREATE INDEX IF NOT EXISTS idx_versions_project ON outline_versions(project_id, id DESC);`
]

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  return {
    force: args.has('--force') || args.has('-f'),
    sqlitePath: (() => {
      for (const arg of Array.from(args)) {
        if (arg.startsWith('--sqlite=')) {
          return path.resolve(arg.split('=')[1])
        }
      }
      return path.resolve(process.env.SQLITE_DB_PATH || DEFAULT_SQLITE_PATH)
    })()
  }
}

function configurePool() {
  if (process.env.DATABASE_URL) {
    const config = { connectionString: process.env.DATABASE_URL }
    if ((process.env.PGSSLMODE || '').toLowerCase() === 'require') {
      config.ssl = { rejectUnauthorized: false }
    }
    return new Pool(config)
  }
  const sslMode = (process.env.PGSSLMODE || '').toLowerCase()
  return new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number.parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'bello_note',
    ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined
  })
}

async function loadSqlite(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`)
  }
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(repoRoot, 'node_modules', 'sql.js', 'dist', file)
  })
  const buffer = fs.readFileSync(sqlitePath)
  return new SQL.Database(buffer)
}

function selectAll(db, sql) {
  const stmt = db.prepare(sql)
  const rows = []
  try {
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
  } finally {
    stmt.free()
  }
  return rows
}

async function ensureSchema(pool) {
  const client = await pool.connect()
  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await client.query(statement)
    }
  } finally {
    client.release()
  }
}

function normalizeTags(raw) {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  if (Array.isArray(raw)) return raw
  return []
}

async function main() {
  const { force, sqlitePath } = parseArgs(process.argv)
  console.log(`[migrate] reading sqlite database from ${sqlitePath}`)
  const sqlite = await loadSqlite(sqlitePath)
  const pool = configurePool()

  await ensureSchema(pool)

  const projects = selectAll(sqlite, 'SELECT id, name, created_at, updated_at FROM projects ORDER BY id ASC')
  const tasks = selectAll(
    sqlite,
    'SELECT id, project_id, parent_id, title, status, content, tags, position, created_at, updated_at FROM tasks ORDER BY created_at ASC, id ASC'
  )
  const workLogs = selectAll(sqlite, 'SELECT task_id, date FROM work_logs ORDER BY id ASC')
  const files = selectAll(
    sqlite,
    'SELECT id, project_id, stored_name, original_name, mime_type, size_bytes, hash, created_at FROM files ORDER BY id ASC'
  )

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existingCount = await client.query('SELECT COUNT(*)::int AS count FROM tasks')
    if (existingCount.rows[0].count > 0 && !force) {
      throw new Error('Target database is not empty. Re-run with --force to truncate existing data first.')
    }

    await client.query('TRUNCATE TABLE work_logs, tasks, files, projects RESTART IDENTITY CASCADE')

    for (const project of projects) {
      await client.query(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [project.id, project.name, project.created_at, project.updated_at]
      )
    }

    const parentAssignments = []
    for (const task of tasks) {
      const parentId = task.parent_id ? String(task.parent_id) : null
      if (parentId) parentAssignments.push({ id: task.id, parentId })
      await client.query(
        `INSERT INTO tasks (id, project_id, parent_id, title, status, content, tags, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz, $10::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          task.id,
          task.project_id,
          null,
          task.title || 'Untitled',
          task.status || 'todo',
          task.content || '',
          JSON.stringify(normalizeTags(task.tags)),
          task.position || 0,
          task.created_at || new Date().toISOString(),
          task.updated_at || new Date().toISOString()
        ]
      )
    }

    for (const assignment of parentAssignments) {
      await client.query(`UPDATE tasks SET parent_id = $2 WHERE id = $1`, [assignment.id, assignment.parentId])
    }

    for (const log of workLogs) {
      await client.query(
        `INSERT INTO work_logs (task_id, date)
         VALUES ($1, $2)
         ON CONFLICT (task_id, date) DO NOTHING`,
        [log.task_id, log.date]
      )
    }

    for (const file of files) {
      await client.query(
        `INSERT INTO files (id, project_id, stored_name, original_name, mime_type, size_bytes, hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          file.id,
          file.project_id,
          file.stored_name,
          file.original_name,
          file.mime_type,
          file.size_bytes,
          file.hash,
          file.created_at
        ]
      )
    }

    await client.query(`
      SELECT setval(pg_get_serial_sequence('projects', 'id'), COALESCE((SELECT MAX(id) FROM projects), 1), true)
    `)
    await client.query(`
      SELECT setval(pg_get_serial_sequence('files', 'id'), COALESCE((SELECT MAX(id) FROM files), 1), true)
    `)

    await client.query('COMMIT')
    console.log('[migrate] migration complete', {
      projects: projects.length,
      tasks: tasks.length,
      workLogs: workLogs.length,
      files: files.length
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[migrate] migration failed', err)
    process.exitCode = 1
  } finally {
    client.release()
    sqlite.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[migrate] unexpected error', err)
  process.exitCode = 1
})
