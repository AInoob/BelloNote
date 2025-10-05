import crypto from 'crypto'

import { db, transaction } from './db.js'
import { parseMaybeJson } from './richtext.js'
import { buildProjectTree } from '../util/tree.js'
import { computeTaskTags, parseTagsField } from '../util/tags.js'

async function canonicalOutline(projectId) {
  const tasks = await db.all(
    `SELECT * FROM tasks WHERE project_id = $1 ORDER BY position ASC, created_at ASC, id ASC`,
    [projectId]
  )
  const map = new Map()
  for (const task of tasks) {
    const dates = Array.isArray(task.worked_dates) ? task.worked_dates : []
    map.set(task.id, dates)
  }
  const roots = buildProjectTree(tasks, map)
  return { roots }
}

function hashDoc(doc) {
  const s = JSON.stringify(doc)
  const h = crypto.createHash('sha1').update(s).digest('hex')
  return { hash: h, size: Buffer.byteLength(s, 'utf8'), json: s }
}

function flatten(doc) {
  const out = new Map()
  function walk(nodes, parentId = null) {
    if (!nodes) return
    for (const n of nodes) {
      out.set(String(n.id), {
        id: String(n.id),
        title: n.title || '',
        status: n.status ?? '',
        parent_id: n.parent_id ?? parentId,
        dates: new Set(n.ownWorkedOnDates || [])
      })
      if (n.children && n.children.length) walk(n.children, n.id)
    }
  }
  walk(doc.roots || [])
  return out
}

function diffDocs(aDoc, bDoc) {
  const A = flatten(aDoc)
  const B = flatten(bDoc)
  const added = []
  const removed = []
  const modified = []
  for (const [id, b] of B.entries()) {
    const a = A.get(id)
    if (!a) {
      added.push({ id, title: b.title })
      continue
    }
    const changes = {}
    if (a.title !== b.title) changes.title = { from: a.title, to: b.title }
    if (a.status !== b.status) changes.status = { from: a.status, to: b.status }
    if (String(a.parent_id || '') !== String(b.parent_id || '')) changes.parent = { from: a.parent_id, to: b.parent_id }
    const aDates = Array.from(a.dates).sort().join(',')
    const bDates = Array.from(b.dates).sort().join(',')
    if (aDates !== bDates) changes.dates = { from: aDates, to: bDates }
    if (Object.keys(changes).length) modified.push({ id, title: b.title, changes })
  }
  for (const [id, a] of A.entries()) {
    if (!B.has(id)) removed.push({ id, title: a.title })
  }
  return { added, removed, modified, summary: { added: added.length, removed: removed.length, modified: modified.length } }
}

function normalizeTimestamp(value) {
  if (!value) return value
  if (value instanceof Date) {
    return value.toISOString().replace(/Z$/, '')
  }
  const str = String(value)
  return str.endsWith('Z') ? str.slice(0, -1) : str
}

export async function recordVersion(projectId, cause = 'autosave', meta = {}) {
  const doc = await canonicalOutline(projectId)
  const { hash, size } = hashDoc(doc)
  const last = await db.get(
    `SELECT id, hash FROM outline_versions WHERE project_id = $1 ORDER BY id DESC LIMIT 1`,
    [projectId]
  )
  const shouldSkip = last && last.hash === hash && cause !== 'manual'
  if (shouldSkip) {
    return { skipped: true, lastId: last.id }
  }

  let metaObj = meta || {}
  let parentId = null
  if (last) {
    parentId = last.id
    const prevRow = await db.get(`SELECT doc_json FROM outline_versions WHERE id = $1`, [last.id])
    const prevDoc = prevRow?.doc_json || null
    if (prevDoc) {
      const d = diffDocs(prevDoc, doc)
      metaObj = { ...metaObj, diffSummary: d.summary }
    }
  } else {
    metaObj = { ...metaObj, diffSummary: { added: 0, removed: 0, modified: 0 } }
  }

  return insertVersion(projectId, cause, parentId, hash, size, doc, metaObj)
}

async function insertVersion(projectId, cause, parentId, hash, size, doc, metaObj) {
  const row = await db.get(
    `INSERT INTO outline_versions (project_id, cause, parent_id, hash, size_bytes, meta, doc_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING id`,
    [projectId, cause, parentId, hash, size, metaObj || {}, doc]
  )
  return { id: row.id }
}

export async function listHistory(projectId, limit = 50, offset = 0) {
  const rows = await db.all(
    `SELECT id, created_at, cause, size_bytes, meta
       FROM outline_versions
      WHERE project_id = $1
      ORDER BY id DESC
      LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  )
  return rows.map((r) => ({
    ...r,
    created_at: normalizeTimestamp(r.created_at),
    meta: r.meta || {}
  }))
}

export async function getVersion(projectId, id) {
  const row = await db.get(
    `SELECT id, created_at, cause, size_bytes, meta, doc_json
       FROM outline_versions
      WHERE project_id = $1 AND id = $2`,
    [projectId, id]
  )
  if (!row) return null
  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at),
    meta: row.meta || {},
    doc: row.doc_json
  }
}

export async function diffBetween(projectId, aId, bId) {
  const a = aId === 'current' ? await canonicalOutline(projectId) : (await getVersion(projectId, aId))?.doc
  const b = bId === 'current' ? await canonicalOutline(projectId) : (await getVersion(projectId, bId))?.doc
  if (!a || !b) return null
  return diffDocs(a, b)
}

export async function restoreVersion(projectId, versionId) {
  const row = await getVersion(projectId, versionId)
  if (!row) throw new Error('Version not found')
  const doc = row.doc

  await transaction(async (tx) => {
    await tx.run(`DELETE FROM tasks WHERE project_id = $1`, [projectId])

    async function insertNodes(nodes, parentId = null) {
      if (!Array.isArray(nodes)) return
      for (let idx = 0; idx < nodes.length; idx += 1) {
        const n = nodes[idx]
        const statusValue = n.status ?? ''
        let contentValue = ''
        let nodesForTags = null
        if (Array.isArray(n.content)) {
          nodesForTags = n.content
          try {
            contentValue = JSON.stringify(n.content)
          } catch {
            contentValue = ''
          }
        } else if (typeof n.content === 'string') {
          contentValue = n.content
          const parsed = parseMaybeJson(n.content)
          if (Array.isArray(parsed)) nodesForTags = parsed
        }
        let tags = parseTagsField(n.tags)
        if (!tags.length) {
          tags = computeTaskTags({
            title: n.title || 'Untitled',
            nodes: nodesForTags,
            html: nodesForTags ? '' : contentValue
          })
        }
        const rawDates = Array.isArray(n.ownWorkedOnDates) ? n.ownWorkedOnDates : []
        const normalizedDates = Array.from(new Set(rawDates.filter(Boolean))).sort()
        const workedDatesJson = JSON.stringify(normalizedDates)
        const firstDate = normalizedDates[0] || null
        const lastDate = normalizedDates.length ? normalizedDates[normalizedDates.length - 1] : null

        await tx.run(
          `INSERT INTO tasks (id, project_id, parent_id, title, status, content, tags, position, worked_dates, first_work_date, last_work_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11)
           ON CONFLICT (id) DO UPDATE
             SET project_id = EXCLUDED.project_id,
                 parent_id = EXCLUDED.parent_id,
                 title = EXCLUDED.title,
                 status = EXCLUDED.status,
                 content = EXCLUDED.content,
                 tags = EXCLUDED.tags,
                 position = EXCLUDED.position,
                 worked_dates = EXCLUDED.worked_dates,
                 first_work_date = EXCLUDED.first_work_date,
                 last_work_date = EXCLUDED.last_work_date,
                 updated_at = NOW()`,
          [
            n.id,
            projectId,
            parentId,
            n.title || 'Untitled',
            statusValue,
            contentValue || '',
            JSON.stringify(tags),
            idx,
            workedDatesJson,
            firstDate,
            lastDate
          ]
        )
        if (Array.isArray(n.children) && n.children.length) {
          await insertNodes(n.children, n.id)
        }
      }
    }

    await insertNodes(doc.roots, null)
  })

  const v = await recordVersion(projectId, 'restore', { fromVersionId: versionId })
  return v
}
