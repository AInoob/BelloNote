#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { randomUUID, createHash } = require('crypto')

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3')
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      const altPath = path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3')
      return require(altPath)
    }
    throw err
  }
}

const Database = loadBetterSqlite3()

function resolveDataDir() {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'server', 'data')
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory not found: ${dataDir}`)
  }
  return dataDir
}

function resolveDbPath() {
  const dataDir = resolveDataDir()
  return process.env.DATA_FILE
    ? path.resolve(process.env.DATA_FILE)
    : path.join(dataDir, 'tasks.db')
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function ensureId(map, oldId) {
  if (oldId === null || oldId === undefined) return null
  const key = String(oldId)
  if (!map.has(key)) map.set(key, randomUUID())
  return map.get(key)
}

function remapOutlineDoc(doc, idMap) {
  if (!doc || typeof doc !== 'object') return doc

  function walk(node) {
    if (!node || typeof node !== 'object') return
    const oldId = node.id
    const newId = ensureId(idMap, oldId)
    if (!newId) throw new Error(`Unable to map outline node id: ${oldId}`)
    node.id = newId
    if ('parent_id' in node) {
      node.parent_id = ensureId(idMap, node.parent_id)
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(walk)
    }
  }

  if (Array.isArray(doc.roots)) {
    doc.roots.forEach(walk)
  }
  return doc
}

function hashDoc(json) {
  const hash = createHash('sha1').update(json).digest('hex')
  const size = Buffer.byteLength(json, 'utf8')
  return { hash, size }
}

function main() {
  const dbPath = resolveDbPath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`)
  }

  const backupPath = `${dbPath}.pre-uuid-${timestamp()}.bak`
  fs.copyFileSync(dbPath, backupPath)
  console.log(`[migration] Backup created at ${backupPath}`)

  const db = new Database(dbPath)
  db.pragma('foreign_keys = OFF')

  const sample = db.prepare('SELECT id FROM tasks LIMIT 1').get()
  if (sample && typeof sample.id === 'string') {
    console.log('[migration] Detected string task IDs already present; skipping migration.')
    db.close()
    return
  }

  const idMap = new Map()

  let finished = false
  try {
    db.exec('BEGIN TRANSACTION')

    const tasksOld = db.prepare('SELECT * FROM tasks').all()
    tasksOld.forEach(row => ensureId(idMap, row.id))

    db.exec('ALTER TABLE tasks RENAME TO tasks_old')
    db.exec('ALTER TABLE work_logs RENAME TO work_logs_old')

    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        content TEXT DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(parent_id) REFERENCES tasks(id)
      );
    `)

    db.exec(`
      CREATE TABLE work_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(task_id, date),
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      );
    `)

    const insertTask = db.prepare(`
      INSERT INTO tasks (id, project_id, parent_id, title, status, content, tags, position, created_at, updated_at)
      VALUES (@id, @project_id, @parent_id, @title, @status, @content, @tags, @position, @created_at, @updated_at)
    `)

    const insertLog = db.prepare(`
      INSERT INTO work_logs (id, task_id, date, created_at)
      VALUES (@id, @task_id, @date, @created_at)
    `)

    const mappedTasks = tasksOld.map(row => ({
      id: ensureId(idMap, row.id),
      project_id: row.project_id,
      parent_id: ensureId(idMap, row.parent_id),
      title: row.title,
      status: row.status,
      content: row.content ?? '',
      tags: row.tags ?? '[]',
      position: row.position ?? 0,
      created_at: row.created_at,
      updated_at: row.updated_at
    }))

    mappedTasks.forEach(row => insertTask.run(row))

    const logsOld = db.prepare('SELECT * FROM work_logs_old').all()
    logsOld.forEach(row => {
      const mappedTaskId = ensureId(idMap, row.task_id)
      if (!mappedTaskId) {
        throw new Error(`Unable to find mapping for work log task_id ${row.task_id}`)
      }
      insertLog.run({
        id: row.id,
        task_id: mappedTaskId,
        date: row.date,
        created_at: row.created_at
      })
    })

    db.exec('DROP TABLE tasks_old')
    db.exec('DROP TABLE work_logs_old')

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(project_id, parent_id, position);
      CREATE INDEX IF NOT EXISTS idx_worklogs_task ON work_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_worklogs_date ON work_logs(date);
    `)

    const versions = db.prepare('SELECT id, doc_json FROM outline_versions').all()
    const updateVersion = db.prepare('UPDATE outline_versions SET doc_json = ?, hash = ?, size_bytes = ? WHERE id = ?')

    versions.forEach(row => {
      let doc
      try {
        doc = JSON.parse(row.doc_json)
      } catch (err) {
        throw new Error(`Failed to parse doc_json for outline_version ${row.id}: ${err.message}`)
      }
      remapOutlineDoc(doc, idMap)
      const json = JSON.stringify(doc)
      const { hash, size } = hashDoc(json)
      updateVersion.run(json, hash, size, row.id)
    })

    db.exec('COMMIT')
    finished = true
    console.log('[migration] Task IDs migrated to UUIDs successfully.')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {}
    throw err
  } finally {
    db.pragma('foreign_keys = ON')
    db.close()
    if (!finished) {
      console.log('[migration] Rolled back changes due to error.')
    }
  }
}

try {
  main()
} catch (err) {
  console.error('[migration] Failed:', err)
  process.exitCode = 1
}
