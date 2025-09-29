
import { Router } from 'express'
import { db } from '../lib/db.js'
import { buildProjectTree } from '../util/tree.js'
import { recordVersion } from '../lib/versioning.js'
import { sanitizeRichText, parseMaybeJson, stringifyNodes, sanitizeHtmlContent } from '../lib/richtext.js'
import { computeTaskTags } from '../util/tags.js'
import { resolveProjectId } from '../util/projectContext.js'

const router = Router()

router.get('/outline', (req, res) => {
  const projectId = resolveProjectId(req)
  const tasks = db.prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY position ASC, created_at ASC, id ASC`).all(projectId)
  const updateContent = db.prepare(`UPDATE tasks SET content=?, updated_at=datetime('now') WHERE id=?`)
  const dataUriRe = /data:[^;]+;base64,/i
  const sanitizedTasks = tasks.map(task => {
    if (!task.content) return task
    const trimmed = typeof task.content === 'string' ? task.content.trim() : ''
    let updatedContent = null
    if (trimmed.startsWith('[')) {
      const rawNodes = parseMaybeJson(task.content)
      const sanitizedNodes = sanitizeRichText(rawNodes, projectId, { title: task.title })
      const json = stringifyNodes(sanitizedNodes)
      if (json !== task.content) updatedContent = json
    } else if (dataUriRe.test(trimmed)) {
      const sanitized = sanitizeHtmlContent(task.content, projectId)
      if (sanitized !== task.content) updatedContent = sanitized
    }
    if (updatedContent !== null) {
      try { updateContent.run(updatedContent, task.id) } catch (err) { console.error('[outline] failed to persist sanitized content', err) }
      return { ...task, content: updatedContent }
    }
    return task
  })
  if (!sanitizedTasks.length) return res.json({ roots: [] })
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
  const tree = buildProjectTree(sanitizedTasks, map)
  res.json({ roots: tree })
})

router.post('/outline', (req, res) => {
  const projectId = resolveProjectId(req)
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

  const insertTask = db.prepare(`INSERT INTO tasks (project_id, parent_id, title, status, content, tags, position) VALUES (@project_id, @parent_id, @title, @status, @content, @tags, @position)`)
  const updateTask = db.prepare(`UPDATE tasks SET parent_id=@parent_id, title=@title, status=@status, content=@content, tags=@tags, position=@position, updated_at=datetime('now') WHERE id=@id`)
  const listLogs = db.prepare(`SELECT date FROM work_logs WHERE task_id = ?`)
  const addLog = db.prepare(`INSERT OR IGNORE INTO work_logs (task_id, date) VALUES (?, ?)`)
  const delLog = db.prepare(`DELETE FROM work_logs WHERE task_id = ? AND date = ?`)

  function upsertNode(node, parent_id = null, position = 0) {
    let realId = null
    const id = node.id
    const rawBody = parseMaybeJson(node.body ?? node.content)
    const sanitizedBody = sanitizeRichText(rawBody, projectId, { title: node.title })
    const contentJson = stringifyNodes(sanitizedBody)
    const tagNodes = Array.isArray(sanitizedBody) ? sanitizedBody : null
    const tags = computeTaskTags({
      title: node.title || 'Untitled',
      nodes: tagNodes,
      html: tagNodes ? '' : contentJson
    })
    const tagsJson = JSON.stringify(tags)
    const normalizedStatus = (node.status ?? '').trim()
    const statusValue = normalizedStatus === 'todo' || normalizedStatus === 'in-progress' || normalizedStatus === 'done' || normalizedStatus === ''
      ? normalizedStatus
      : ''
    if (!id || String(id).startsWith('new-')) {
      const info = insertTask.run({ project_id: projectId, parent_id, title: node.title || 'Untitled', status: statusValue, content: contentJson, tags: tagsJson, position })
      realId = info.lastInsertRowid
      if (id) newIdMap[id] = realId
    } else {
      realId = Number(id)
      updateTask.run({ id: realId, parent_id, title: node.title || 'Untitled', status: statusValue, content: contentJson, tags: tagsJson, position })
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
