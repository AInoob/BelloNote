import { Router } from 'express'
import fs from 'fs'

import { getFileById, getDiskPathForFile } from '../lib/files.js'

const router = Router()

router.get('/:id/:name?', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid file id' })
  }
  try {
    const file = await getFileById(id)
    if (!file) return res.status(404).json({ error: 'File not found' })
    const diskPath = getDiskPathForFile(file)
    try {
      const stat = fs.statSync(diskPath)
      if (!stat.isFile()) throw new Error('Not a file')
    } catch (err) {
      console.error('[files] missing on disk', { id, diskPath, err: err.message })
      return res.status(404).json({ error: 'File missing' })
    }
    const download = req.query.download === '1' || req.query.download === 'true'
    res.type(file.mime_type || 'application/octet-stream')
    if (download) {
      const name = file.original_name || file.stored_name
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`)
    }
    return res.sendFile(diskPath, (err) => {
      if (err) {
        console.error('[files] send error', err)
        if (!res.headersSent) res.status(500).end()
      }
    })
  } catch (err) {
    console.error('[files] failed to serve file', err)
    return res.status(500).json({ error: 'Internal error' })
  }
})

export default router
