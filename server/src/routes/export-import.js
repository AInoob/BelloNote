import fs from 'fs/promises'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'

import { resolveProjectId } from '../util/projectContext.js'
import { buildExportManifest } from '../lib/exporter.js'
import { importManifest } from '../lib/importer.js'

const tempUploadDir = path.join(process.cwd(), '.tmp-uploads')
await fs.mkdir(tempUploadDir, { recursive: true })

const upload = multer({ dest: tempUploadDir })

const router = Router()

router.get('/export', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)
    const manifest = await buildExportManifest({ projectId })
    const payload = JSON.stringify(manifest, null, 2)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="bellonote-export-${Date.now()}.json"`)
    return res.status(200).send(payload)
  } catch (err) {
    console.error('[export] failed to build manifest', err)
    return res.status(500).json({ error: err.message || 'Failed to export' })
  }
})

router.post('/import', upload.single('manifest'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'manifest file is required' })
  }
  const tmpPath = req.file.path
  try {
    const projectId = await resolveProjectId(req)
    const schemaPath = path.join(process.cwd(), 'manifest.schema.json')
    const result = await importManifest({ manifestPath: tmpPath, schemaPath, projectId })
    await fs.unlink(tmpPath).catch(() => {})
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[import] failed', err)
    await fs.unlink(tmpPath).catch(() => {})
    return res.status(400).json({ ok: false, error: err.message || 'Import failed' })
  }
})

export default router
