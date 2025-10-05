import fs from 'fs'
import path from 'path'
import { Router } from 'express'

import { transaction } from '../lib/db.js'
import { getUploadDir } from '../lib/files.js'

const router = Router()

function isPlaywrightRequest(req) {
  return req.headers['x-playwright-test'] && process.env.NODE_ENV !== 'production'
}

function clearUploadsDirectory() {
  try {
    const uploadDir = getUploadDir()
    const entries = fs.readdirSync(uploadDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.gitkeep' || entry.name === '.gitignore') continue
      const targetPath = path.join(uploadDir, entry.name)
      try {
        if (entry.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true })
        else fs.unlinkSync(targetPath)
      } catch (err) {
        if (err?.code === 'ENOENT') continue
        throw err
      }
    }
  } catch (err) {
    console.error('[test-utils] failed to clear uploads directory', err)
    throw err
  }
}

router.post('/reset', async (req, res) => {
  if (!isPlaywrightRequest(req)) return res.status(403).json({ error: 'forbidden' })

  try {
    await transaction(async (tx) => {
      // Truncate known tables; tolerate missing ones across schema versions
      try { await tx.run('TRUNCATE TABLE work_logs RESTART IDENTITY CASCADE') } catch {}
      try { await tx.run('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE') } catch {}
      try { await tx.run('TRUNCATE TABLE outline_versions RESTART IDENTITY CASCADE') } catch {}
      try { await tx.run('TRUNCATE TABLE files RESTART IDENTITY CASCADE') } catch {}
    })
    clearUploadsDirectory()
    return res.json({ ok: true })
  } catch (err) {
    console.error('[test-utils] reset failed', err)
    return res.status(500).json({ error: err.message || 'reset failed' })
  }
})

export default router
