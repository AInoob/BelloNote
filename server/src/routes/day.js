
import { Router } from 'express'
import { db } from '../lib/db.js'
import { ensureDefaultProject } from '../lib/projects.js'

const router = Router()

function ensureProjectForTests(req) {
  if (req.headers['x-playwright-test'] && process.env.NODE_ENV !== 'production') {
    const row = db.prepare('SELECT id FROM projects WHERE name = ?').get('Playwright E2E')
    if (!row) {
      const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run('Playwright E2E')
      return info.lastInsertRowid
    }
    return row.id
  }
  return null
}

function inferTestProjectIdIfPlaywrightDataDir() {
  try {
    const dir = process.env.DATA_DIR || ''
    if (dir.includes('.playwright-data')) {
      const row = db.prepare('SELECT id FROM projects WHERE name = ?').get('Playwright E2E')
      if (row?.id) return row.id
      const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run('Playwright E2E')
      return info.lastInsertRowid
    }
  } catch {}
  return null
}

function loadAllTasks(projectId) {
  return db.prepare(`SELECT id, parent_id, title, status, content, project_id, created_at FROM tasks WHERE project_id = ?`).all(projectId)
}
function pathToRoot(task, byId) {
  const path = []
  let cur = task
  const guard = new Set()
  while (cur) {
    if (guard.has(cur.id)) break
    guard.add(cur.id)
    path.push({ id: cur.id, title: cur.title, status: cur.status, parent_id: cur.parent_id, content: cur.content })
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  path.reverse()
  return path
}

router.get('/', (req, res) => {
  const testProjectId = ensureProjectForTests(req)
  const inferred = inferTestProjectIdIfPlaywrightDataDir()
  const projectId = testProjectId || inferred || ensureDefaultProject()
  const dates = db.prepare(`
    SELECT DISTINCT w.date
    FROM work_logs w
    JOIN tasks t ON t.id = w.task_id
    WHERE t.project_id = ?
    ORDER BY w.date DESC
  `).all(projectId).map(r => r.date)
  const all = loadAllTasks(projectId)
  const byId = new Map(all.map(t => [t.id, t]))
  const children = new Map()
  for (const t of all) {
    const pid = t.parent_id || null
    if (!pid) continue
    if (!children.has(pid)) children.set(pid, [])
    children.get(pid).push(t)
  }
  // Stable child ordering by created_at
  for (const arr of children.values()) {
    arr.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  }

  const days = dates.map(d => {
    const rows = db.prepare(`
      SELECT t.* FROM work_logs w
      JOIN tasks t ON t.id = w.task_id
      WHERE w.date = ? AND t.project_id = ?
      ORDER BY t.created_at ASC
    `).all(d, projectId)

    const seedIds = rows.map(r => r.id)

    const included = new Set()
    const orderedIds = []
    const addTaskAndDescendants = (taskId) => {
      if (included.has(taskId)) return
      included.add(taskId)
      orderedIds.push(taskId)
      const kids = children.get(taskId) || []
      for (const ch of kids) addTaskAndDescendants(ch.id)
    }

    for (const r of rows) addTaskAndDescendants(r.id)

    const items = orderedIds.map(id => {
      const task = byId.get(id)
      return { task_id: id, path: pathToRoot(task, byId) }
    })
    return { date: d, seedIds, items }
  })
  res.json({ days })
})

export default router
