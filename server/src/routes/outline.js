import { randomUUID } from 'crypto'
import { Router } from 'express'

import { db, transaction } from '../lib/db.js'
import { buildProjectTree } from '../util/tree.js'
import { recordVersion } from '../lib/versioning.js'
import { sanitizeRichText, parseMaybeJson, stringifyNodes, sanitizeHtmlContent } from '../lib/richtext.js'
import { computeTaskTags } from '../util/tags.js'
import { resolveProjectId } from '../util/projectContext.js'

const router = Router()

router.get('/outline', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const tasks = await db.all(
      `SELECT * FROM tasks WHERE project_id = $1 ORDER BY position ASC, created_at ASC, id ASC`,
      [projectId]
    )

    const dataUriRe = /data:[^;]+;base64,/i
    for (const task of tasks) {
      if (!task.content) continue
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
        try {
          await db.run(`UPDATE tasks SET content = $1, updated_at = NOW() WHERE id = $2`, [updatedContent, task.id])
          task.content = updatedContent
        } catch (err) {
          console.error('[outline] failed to persist sanitized content', err)
        }
      }
    }

    if (!tasks.length) return res.json({ roots: [] })

    const map = new Map()
    for (const task of tasks) {
      const dates = Array.isArray(task.worked_dates) ? task.worked_dates : []
      map.set(task.id, dates)
    }
    const tree = buildProjectTree(tasks, map)
    return res.json({ roots: tree })
  } catch (err) {
    console.error('[outline] failed to load outline', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

router.post('/outline', async (req, res) => {
  const projectId = await resolveProjectId(req)
  const { outline } = req.body
  if (!Array.isArray(outline)) return res.status(400).json({ error: 'outline array required' })

  const newIdMap = {}

  try {
    const { deleted } = await transaction(async (tx) => {
      const existingRows = await tx.all(`SELECT id FROM tasks WHERE project_id = $1`, [projectId])
      const existing = existingRows.map((r) => String(r.id))
      const seen = new Set()

      async function upsertNode(node, parentId = null, position = 0) {
        let realId
        const rawId = node.id
        const id = rawId == null ? null : String(rawId)
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
        const statusValue = ['todo', 'in-progress', 'done', ''].includes(normalizedStatus)
          ? normalizedStatus
          : ''

        const rawDates = Array.isArray(node.dates) ? node.dates : []
        const normalizedDates = Array.from(new Set(rawDates.filter(Boolean))).sort()
        const workedDatesJson = JSON.stringify(normalizedDates)
        const firstDate = normalizedDates[0] || null
        const lastDate = normalizedDates.length ? normalizedDates[normalizedDates.length - 1] : null

        if (!id || id.startsWith('new-')) {
          realId = randomUUID()
          await tx.run(
            `INSERT INTO tasks (id, project_id, parent_id, title, status, content, tags, position, worked_dates, first_work_date, last_work_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11)`,
            [
              realId,
              projectId,
              parentId,
              node.title || 'Untitled',
              statusValue,
              contentJson,
              tagsJson,
              position,
              workedDatesJson,
              firstDate,
              lastDate
            ]
          )
          if (id) newIdMap[id] = realId
        } else {
          realId = id
          await tx.run(
            `UPDATE tasks
               SET parent_id = $1,
                   title = $2,
                   status = $3,
                   content = $4,
                   tags = $5::jsonb,
                   position = $6,
                   worked_dates = $7::jsonb,
                   first_work_date = $8,
                   last_work_date = $9,
                   updated_at = NOW()
             WHERE id = $10`,
            [
              parentId,
              node.title || 'Untitled',
              statusValue,
              contentJson,
              tagsJson,
              position,
              workedDatesJson,
              firstDate,
              lastDate,
              realId
            ]
          )
        }
        seen.add(realId)

        if (Array.isArray(node.children)) {
          for (let idx = 0; idx < node.children.length; idx += 1) {
            await upsertNode(node.children[idx], realId, idx)
          }
        }
      }

      for (let idx = 0; idx < outline.length; idx += 1) {
        await upsertNode(outline[idx], null, idx)
      }

      const unseen = existing.filter((id) => !seen.has(id))
      if (unseen.length) {
        await tx.run(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [unseen])
      }

      return { deleted: unseen }
    })

    await recordVersion(projectId, 'autosave')

    return res.json({ ok: true, newIdMap, deleted })
  } catch (err) {
    console.error('[outline] failed to save outline', err)
    return res.status(500).json({ error: err.message || 'Failed to save outline' })
  }
})

export default router
