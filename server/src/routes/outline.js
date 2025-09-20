
import { Router } from 'express'
import { db } from '../lib/db.js'
import { buildProjectTree } from '../util/tree.js'
import { recordVersion } from '../lib/versioning.js'

const router = Router()

function ensureWorkspaceId() {
  const row = db.prepare(`SELECT id FROM projects ORDER BY id ASC LIMIT 1`).get()
  if (row) return row.id
  return db.prepare(`INSERT INTO projects (name) VALUES (?)`).run('Workspace').lastInsertRowid
}

router.get('/outline', (req, res) => {
  const projectId = ensureWorkspaceId()
  const tasks = db.prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY position ASC, created_at ASC, id ASC`).all(projectId)
  if (!tasks.length) return res.json({ roots: [] })
  const logs = db.prepare(`
    SELECT w.task_id, w.date
    FROM work_logs w
    JOIN tasks t ON t.id = w.task_id
    WHERE t.project_id = ?
  `).all(projectId)
  const map = new Map()
  for (const l of logs) {
    if (!map.has(l.task_id)) map.set(l.task_id, [])
    map.get(l.task_id).push(l.date)
  }
  const tree = buildProjectTree(tasks, map)
  res.json({ roots: tree })
})

router.post('/outline', (req, res) => {
  const projectId = ensureWorkspaceId()
  const { outline } = req.body
  if (!Array.isArray(outline)) return res.status(400).json({ error: 'outline array required' })

  try {
    console.log('[outline] save', outline.map(o => ({ id: o.id, title: o.title, dates: o.dates, children: (o.children || []).length })))
  } catch (e) {
    console.log('[outline] save log failed', e.message)
  }

  const existing = db.prepare(`SELECT id FROM tasks WHERE project_id = ?`).all(projectId).map(r => r.id)
  const seen = new Set()
  const newIdMap = {}

  const insertTask = db.prepare(`INSERT INTO tasks (project_id, parent_id, title, status, content, position) VALUES (@project_id, @parent_id, @title, @status, @content, @position)`)
  const updateTask = db.prepare(`UPDATE tasks SET parent_id=@parent_id, title=@title, status=@status, content=@content, position=@position, updated_at=datetime('now') WHERE id=@id`)
  const listLogs = db.prepare(`SELECT date FROM work_logs WHERE task_id = ?`)
  const addLog = db.prepare(`INSERT OR IGNORE INTO work_logs (task_id, date) VALUES (?, ?)`)
  const delLog = db.prepare(`DELETE FROM work_logs WHERE task_id = ? AND date = ?`)

  function upsertNode(node, parent_id = null, position = 0) {
    let realId = null
    const id = node.id
    const contentJson = Array.isArray(node.body)
      ? JSON.stringify(node.body)
      : (typeof node.content === 'string' ? node.content : '[]')
    if (!id || String(id).startsWith('new-')) {
      const info = insertTask.run({ project_id: projectId, parent_id, title: node.title || 'Untitled', status: node.status || 'todo', content: contentJson, position })
      realId = info.lastInsertRowid
      if (id) newIdMap[id] = realId
    } else {
      realId = Number(id)
      updateTask.run({ id: realId, parent_id, title: node.title || 'Untitled', status: node.status || 'todo', content: contentJson, position })
    }
    seen.add(realId)

    const wanted = new Set((node.dates || []).filter(Boolean))
    const have = new Set(listLogs.all(realId).map(r => r.date))
    for (const d of wanted) if (!have.has(d)) addLog.run(realId, d)
    for (const d of have) if (!wanted.has(d)) delLog.run(realId, d)

    ;(node.children || []).forEach((ch, idx) => upsertNode(ch, realId, idx))
  }

  try {
    db.exec('BEGIN')
    outline.forEach((n, idx) => upsertNode(n, null, idx))
    const unseen = existing.filter(id => !seen.has(id))
    if (unseen.length) {
      const ph = unseen.map(_ => '?').join(',')
      db.prepare(`DELETE FROM work_logs WHERE task_id IN (${ph})`).run(...unseen)
      db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...unseen)
    }
    db.exec('COMMIT')
    recordVersion(projectId, 'autosave')
    res.json({ ok: true, newIdMap, deleted: unseen })
  } catch (e) {
    db.exec('ROLLBACK')
    res.status(500).json({ error: e.message })
  }
})

export default router
