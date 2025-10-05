
import { Router } from 'express'

import { listHistory, getVersion, diffBetween, restoreVersion, recordVersion } from '../lib/versioning.js'
import { resolveProjectId } from '../util/projectContext.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const limit = Math.min(Number(req.query.limit || 50), 200)
    const offset = Math.max(Number(req.query.offset || 0), 0)
    const rows = await listHistory(projectId, limit, offset)
    return res.json({ items: rows })
  } catch (err) {
    console.error('[history] failed to list history', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const id = Number(req.params.id)
    const row = await getVersion(projectId, id)
    if (!row) return res.status(404).json({ error: 'Version not found' })
    return res.json({
      id: row.id,
      created_at: row.created_at,
      cause: row.cause,
      size_bytes: row.size_bytes,
      meta: row.meta,
      doc: row.doc
    })
  } catch (err) {
    console.error('[history] failed to load version', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

router.get('/:id/diff', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const id = req.params.id
    const against = req.query.against || 'current'
    const diff = await diffBetween(projectId, id, against)
    if (!diff) return res.status(404).json({ error: 'Diff not available' })
    return res.json(diff)
  } catch (err) {
    console.error('[history] failed to diff versions', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

router.post('/:id/restore', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const id = Number(req.params.id)
    const v = await restoreVersion(projectId, id)
    return res.json({ ok: true, restoredTo: id, newVersionId: v.id })
  } catch (err) {
    console.error('[history] failed to restore version', err)
    return res.status(500).json({ error: err.message || 'restore failed' })
  }
})

router.post('/checkpoint', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const note = (req.body && req.body.note) || ''
    const v = await recordVersion(projectId, 'manual', { note })
    return res.json({ ok: true, versionId: v.id ?? v.lastId ?? null })
  } catch (err) {
    console.error('[history] failed to create checkpoint', err)
    return res.status(500).json({ error: err.message || 'checkpoint failed' })
  }
})

export default router
