import { db } from './db.js'

export function ensureDefaultProject() {
  const row = db.prepare(`SELECT id FROM projects ORDER BY id ASC LIMIT 1`).get()
  if (row) return row.id
  return db.prepare(`INSERT INTO projects (name) VALUES (?)`).run('Workspace').lastInsertRowid
}
