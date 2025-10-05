import { db } from './db.js'

export async function ensureDefaultProject() {
  const row = await db.get(`SELECT id FROM projects ORDER BY id ASC LIMIT 1`)
  if (row?.id) return row.id
  const created = await db.get(`INSERT INTO projects (name) VALUES ($1) RETURNING id`, ['Workspace'])
  return created.id
}
