
import { Router } from 'express'
import { db } from '../lib/db.js'
import { parseMaybeJson, sanitizeRichText, stringifyNodes, sanitizeHtmlContent } from '../lib/richtext.js'
import { computeTaskTags, parseTagsField } from '../util/tags.js'

const router = Router()

router.get('/:id', (req, res) => {
  const id = String(req.params.id)
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.content) {
    const trimmed = typeof row.content === 'string' ? row.content.trim() : ''
    const dataUriRe = /data:[^;]+;base64,/i
    if (trimmed.startsWith('[')) {
      const rawNodes = parseMaybeJson(row.content)
      const sanitizedNodes = sanitizeRichText(rawNodes, row.project_id, { title: row.title })
      const json = stringifyNodes(sanitizedNodes)
      if (json !== row.content) {
        try { db.prepare(`UPDATE tasks SET content=?, updated_at=datetime('now') WHERE id=?`).run(json, id) } catch (err) { console.error('[tasks] failed to persist sanitized content', err) }
        row.content = json
      }
    } else if (dataUriRe.test(trimmed)) {
      const sanitized = sanitizeHtmlContent(row.content, row.project_id)
      if (sanitized !== row.content) {
        try { db.prepare(`UPDATE tasks SET content=?, updated_at=datetime('now') WHERE id=?`).run(sanitized, id) } catch (err) { console.error('[tasks] failed to persist sanitized html', err) }
        row.content = sanitized
      }
    }
  }
  const logs = db.prepare(`SELECT date FROM work_logs WHERE task_id = ? ORDER BY date DESC`).all(id)
  const tags = parseTagsField(row.tags)
  res.json({ ...row, tags, workedOnDates: logs.map(l => l.date) })
})

router.patch('/:id', (req, res) => {
  const id = String(req.params.id)
  const cur = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)
  if (!cur) return res.status(404).json({ error: 'Not found' })
  const title = 'title' in req.body ? req.body.title : cur.title
  const status = 'status' in req.body ? req.body.status : cur.status
  let content = cur.content
  let sanitizedNodes = null
  if ('content' in req.body) {
    const incoming = req.body.content
    const looksJsonArray = Array.isArray(incoming) || (typeof incoming === 'string' && incoming.trim().startsWith('['))
    if (looksJsonArray) {
      const rawNodes = parseMaybeJson(incoming)
      sanitizedNodes = sanitizeRichText(rawNodes, cur.project_id, { title })
      content = stringifyNodes(sanitizedNodes)
    } else if (typeof incoming === 'string') {
      content = sanitizeHtmlContent(incoming, cur.project_id)
    } else {
      content = incoming
    }
  }
  let tags = parseTagsField(cur.tags)
  if ('content' in req.body || 'title' in req.body) {
    tags = computeTaskTags({
      title,
      nodes: sanitizedNodes,
      html: sanitizedNodes ? '' : (typeof content === 'string' ? content : '')
    })
  }
  db.prepare(`UPDATE tasks SET title=?, status=?, content=?, tags=?, updated_at=datetime('now') WHERE id=?`).run(title, status, content, JSON.stringify(tags), id)
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)
  res.json({ ...row, tags })
})

export default router
