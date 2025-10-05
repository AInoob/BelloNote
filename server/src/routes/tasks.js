import { Router } from 'express'

import { db } from '../lib/db.js'
import { parseMaybeJson, sanitizeRichText, stringifyNodes, sanitizeHtmlContent } from '../lib/richtext.js'
import { computeTaskTags, parseTagsField } from '../util/tags.js'

const router = Router()

router.get('/:id', async (req, res) => {
  const id = String(req.params.id)
  try {
    const row = await db.get(`SELECT * FROM tasks WHERE id = $1`, [id])
    if (!row) return res.status(404).json({ error: 'Not found' })

    if (row.content) {
      const trimmed = typeof row.content === 'string' ? row.content.trim() : ''
      const dataUriRe = /data:[^;]+;base64,/i
      if (trimmed.startsWith('[')) {
        const rawNodes = parseMaybeJson(row.content)
        const sanitizedNodes = sanitizeRichText(rawNodes, row.project_id, { title: row.title })
        const json = stringifyNodes(sanitizedNodes)
        if (json !== row.content) {
          try {
            await db.run(`UPDATE tasks SET content = $1, updated_at = NOW() WHERE id = $2`, [json, id])
            row.content = json
          } catch (err) {
            console.error('[tasks] failed to persist sanitized content', err)
          }
        }
      } else if (dataUriRe.test(trimmed)) {
        const sanitized = sanitizeHtmlContent(row.content, row.project_id)
        if (sanitized !== row.content) {
          try {
            await db.run(`UPDATE tasks SET content = $1, updated_at = NOW() WHERE id = $2`, [sanitized, id])
            row.content = sanitized
          } catch (err) {
            console.error('[tasks] failed to persist sanitized html', err)
          }
        }
      }
    }

    const tags = parseTagsField(row.tags)
    const workedDates = Array.isArray(row.worked_dates) ? row.worked_dates : []
    return res.json({ ...row, tags, workedOnDates: workedDates })
  } catch (err) {
    console.error('[tasks] failed to load task', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

router.patch('/:id', async (req, res) => {
  const id = String(req.params.id)
  try {
    const cur = await db.get(`SELECT * FROM tasks WHERE id = $1`, [id])
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

    await db.run(
      `UPDATE tasks
       SET title = $1, status = $2, content = $3, tags = $4::jsonb, updated_at = NOW()
       WHERE id = $5`,
      [title, status, content, JSON.stringify(tags), id]
    )

    const row = await db.get(`SELECT * FROM tasks WHERE id = $1`, [id])
    return res.json({ ...row, tags })
  } catch (err) {
    console.error('[tasks] failed to update task', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

export default router
