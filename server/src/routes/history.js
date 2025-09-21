
import { Router } from 'express'
import { listHistory, getVersion, diffBetween, restoreVersion, recordVersion } from '../lib/versioning.js'
import { ensureDefaultProject } from '../lib/projects.js'

const router = Router()

router.get('/', (req, res) => {
  const projectId = ensureDefaultProject()
  const limit = Math.min(Number(req.query.limit || 50), 200)
  const offset = Math.max(Number(req.query.offset || 0), 0)
  const rows = listHistory(projectId, limit, offset)
  res.json({ items: rows })
})

router.get('/:id', (req, res) => {
  const projectId = ensureDefaultProject()
  const id = Number(req.params.id)
  const row = getVersion(projectId, id)
  if (!row) return res.status(404).json({ error: 'Version not found' })
  res.json({ id: row.id, created_at: row.created_at, cause: row.cause, size_bytes: row.size_bytes, meta: row.meta, doc: row.doc })
})

router.get('/:id/diff', (req, res) => {
  const projectId = ensureDefaultProject()
  const id = req.params.id
  const against = req.query.against || 'current'
  const diff = diffBetween(projectId, id, against)
  if (!diff) return res.status(404).json({ error: 'Diff not available' })
  res.json(diff)
})

router.post('/:id/restore', (req, res) => {
  const projectId = ensureDefaultProject()
  const id = Number(req.params.id)
  try {
    const v = restoreVersion(projectId, id)
    res.json({ ok: true, restoredTo: id, newVersionId: v.id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/checkpoint', (req, res) => {
  const projectId = ensureDefaultProject()
  const note = (req.body && req.body.note) || ''
  try {
    const v = recordVersion(projectId, 'manual', { note })
    res.json({ ok: true, versionId: v.id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
