
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(dataDir, 'tasks.db')

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  parent_id INTEGER,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  content TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(parent_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS work_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, date),
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(project_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_worklogs_task ON work_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_date ON work_logs(date);

CREATE TABLE IF NOT EXISTS outline_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cause TEXT NOT NULL DEFAULT 'autosave',
  parent_id INTEGER,
  hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  meta TEXT DEFAULT '{}',
  doc_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON outline_versions(project_id, id DESC);
`)

// Migration: add position column if missing
const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name)
if (!cols.includes('position')) {
  db.exec("ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;")
}
