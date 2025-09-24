
import crypto from 'crypto'
import { db } from './db.js'
import { parseMaybeJson } from './richtext.js'
import { buildProjectTree } from '../util/tree.js'
import { computeTaskTags, parseTagsField } from '../util/tags.js'

function canonicalOutline(projectId) {
  const tasks = db.prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY position ASC, created_at ASC, id ASC`).all(projectId)
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
  function walk(nodes, parentId=null) {
    if (!nodes) return
    for (const n of nodes) {
      out.set(String(n.id), {
        id: String(n.id),
        title: n.title || '',
        status: (n.status ?? ''),
        parent_id: n.parent_id ?? parentId,
        dates: new Set(n.ownWorkedOnDates || []),
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
  const added = [], removed = [], modified = []
  for (const [id, b] of B.entries()) {
    const a = A.get(id)
    if (!a) { added.push({ id, title: b.title }); continue }
    const changes = {}
    if (a.title !== b.title) changes.title = { from: a.title, to: b.title }
    if (a.status !== b.status) changes.status = { from: a.status, to: b.status }
    if (String(a.parent_id||'') !== String(b.parent_id||'')) changes.parent = { from: a.parent_id, to: b.parent_id }
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

export function recordVersion(projectId, cause='autosave', meta={}) {
  const doc = canonicalOutline(projectId)
  const { hash, size, json } = hashDoc(doc)
  const last = db.prepare(`SELECT id, hash FROM outline_versions WHERE project_id = ? ORDER BY id DESC LIMIT 1`).get(projectId)
  if (last && last.hash === hash) {
    return { skipped: true, lastId: last.id }
  }
  let metaObj = meta || {}
  if (last) {
    const prev = JSON.parse(db.prepare(`SELECT doc_json FROM outline_versions WHERE id = ?`).get(last.id).doc_json)
    const d = diffDocs(prev, doc)
    metaObj = { ...metaObj, diffSummary: d.summary }
    return insertVersion(projectId, cause, last.id, hash, size, json, metaObj)
  } else {
    metaObj = { ...metaObj, diffSummary: { added: 0, removed: 0, modified: 0 } }
    return insertVersion(projectId, cause, null, hash, size, json, metaObj)
  }
}

function insertVersion(projectId, cause, parentId, hash, size, json, metaObj) {
  const info = db.prepare(`
    INSERT INTO outline_versions (project_id, cause, parent_id, hash, size_bytes, meta, doc_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, cause, parentId, hash, size, JSON.stringify(metaObj), json)
  return { id: info.lastInsertRowid }
}

export function listHistory(projectId, limit=50, offset=0) {
  const rows = db.prepare(`
    SELECT id, created_at, cause, size_bytes, meta
    FROM outline_versions
    WHERE project_id = ?
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(projectId, limit, offset)
  return rows.map(r => ({ ...r, meta: safeParse(r.meta) }))
}

function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }

export function getVersion(projectId, id) {
  const row = db.prepare(`SELECT id, created_at, cause, size_bytes, meta, doc_json FROM outline_versions WHERE project_id = ? AND id = ?`).get(projectId, id)
  if (!row) return null
  return { ...row, meta: safeParse(row.meta), doc: JSON.parse(row.doc_json) }
}

export function diffBetween(projectId, aId, bId) {
  const a = aId === 'current' ? canonicalOutline(projectId) : getVersion(projectId, aId)?.doc
  const b = bId === 'current' ? canonicalOutline(projectId) : getVersion(projectId, bId)?.doc
  if (!a || !b) return null
  return diffDocs(a, b)
}

export function restoreVersion(projectId, versionId) {
  const row = getVersion(projectId, versionId)
  if (!row) throw new Error('Version not found')
  const doc = row.doc
  db.exec('BEGIN')
  db.prepare(`DELETE FROM work_logs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?);`).run(projectId)
  db.prepare(`DELETE FROM tasks WHERE project_id = ?;`).run(projectId)

  const insTask = db.prepare(`INSERT INTO tasks (id, project_id, parent_id, title, status, content, tags, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
  const insLog = db.prepare(`INSERT OR IGNORE INTO work_logs (task_id, date) VALUES (?, ?)`)

  function insertNodes(nodes, parentId=null) {
    if (!nodes) return
    nodes.forEach((n, idx) => {
      const statusValue = (n.status ?? '')
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
      } else {
        contentValue = ''
      }
      let tags = parseTagsField(n.tags)
      if (!tags.length) {
        tags = computeTaskTags({
          title: n.title || 'Untitled',
          nodes: nodesForTags,
          html: nodesForTags ? '' : contentValue
        })
      }
      insTask.run(n.id, projectId, parentId, n.title || 'Untitled', statusValue, contentValue || '', JSON.stringify(tags), idx)
      for (const d of (n.ownWorkedOnDates || [])) insLog.run(n.id, d)
      if (n.children && n.children.length) insertNodes(n.children, n.id)
    })
  }
  insertNodes(doc.roots, null)
  db.exec('COMMIT')

  const v = recordVersion(projectId, 'restore', { fromVersionId: versionId })
  return v
}
