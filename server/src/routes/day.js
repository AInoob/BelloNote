
import { Router } from 'express'
import { db } from '../lib/db.js'

const router = Router()

function loadAllTasks() {
  return db.prepare(`SELECT id, parent_id, title, status, project_id FROM tasks`).all()
}
function pathToRoot(task, byId) {
  const path = []
  let cur = task
  const guard = new Set()
  while (cur) {
    if (guard.has(cur.id)) break
    guard.add(cur.id)
    path.push({ id: cur.id, title: cur.title, status: cur.status, parent_id: cur.parent_id })
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  path.reverse()
  return path
}

router.get('/', (req, res) => {
  const dates = db.prepare(`SELECT DISTINCT date FROM work_logs ORDER BY date DESC`).all().map(r => r.date)
  const all = loadAllTasks()
  const byId = new Map(all.map(t => [t.id, t]))
  const days = dates.map(d => {
    const rows = db.prepare(`
      SELECT t.* FROM work_logs w
      JOIN tasks t ON t.id = w.task_id
      WHERE w.date = ?
      ORDER BY t.created_at ASC
    `).all(d)
    const items = rows.map(r => ({ task_id: r.id, path: pathToRoot(r, byId) }))
    return { date: d, items }
  })
  res.json({ days })
})

export default router
