
import { Router } from 'express'
import { db } from '../lib/db.js'
import { ensureDefaultProject } from '../lib/projects.js'
import { parseTagsField } from '../util/tags.js'

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
  return db.prepare(`SELECT id, parent_id, title, status, content, tags, project_id, created_at FROM tasks WHERE project_id = ?`).all(projectId)
}
function pathToRoot(task, byId) {
  const path = []
  let cur = task
  const guard = new Set()
  while (cur) {
    if (guard.has(cur.id)) break
    guard.add(cur.id)
    path.push({ id: cur.id, title: cur.title, status: cur.status, parent_id: cur.parent_id, content: cur.content, tags: parseTagsField(cur.tags) })
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  path.reverse()
  return path
}

router.get('/', (req, res) => {
  const testProjectId = ensureProjectForTests(req)
  const inferred = inferTestProjectIdIfPlaywrightDataDir()
  const projectId = testProjectId || inferred || ensureDefaultProject()
  const workLogDates = db.prepare(`
    SELECT DISTINCT w.date AS date
    FROM work_logs w
    JOIN tasks t ON t.id = w.task_id
    WHERE t.project_id = ?
  `).all(projectId).map(r => r.date).filter(Boolean)

  const reminderDates = db.prepare(`
    SELECT DISTINCT date(r.remind_at) AS date
    FROM reminders r
    JOIN tasks t ON t.id = r.task_id
    WHERE t.project_id = ?
      AND r.remind_at IS NOT NULL
      AND r.status != 'completed'
      AND (r.dismissed_at IS NULL OR r.dismissed_at = '')
  `).all(projectId).map(r => r.date).filter(Boolean)

  const dateSet = new Set([...workLogDates, ...reminderDates])
  const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a))
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

    const reminders = db.prepare(`
      SELECT t.*
      FROM reminders r
      JOIN tasks t ON t.id = r.task_id
      WHERE t.project_id = ?
        AND r.remind_at IS NOT NULL
        AND date(r.remind_at) = ?
        AND r.status != 'completed'
        AND (r.dismissed_at IS NULL OR r.dismissed_at = '')
      ORDER BY r.remind_at ASC
    `).all(projectId, d)

    const seedIdSet = new Set(rows.map(r => r.id))
    const reminderIdSet = new Set(reminders.map(r => r.id))
    const seedIds = Array.from(seedIdSet)

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
    for (const r of reminders) addTaskAndDescendants(r.id)

    const items = orderedIds.map(id => {
      const task = byId.get(id)
      return { task_id: id, path: pathToRoot(task, byId) }
    })
    return { date: d, seedIds, reminderIds: Array.from(reminderIdSet), items }
  })
  res.json({ days })
})

export default router
