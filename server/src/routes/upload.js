
import { Router } from 'express'
import multer from 'multer'

import { ensureUploadDir, getUploadDir, storeDiskFile } from '../lib/files.js'
import { resolveProjectId } from '../util/projectContext.js'

ensureUploadDir()

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, getUploadDir()),
  filename: (req, file, cb) => {
    const safe = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') : 'upload'
    cb(null, `${Date.now()}_${safe}`)
  }
})

const upload = multer({ storage })
const router = Router()

router.post('/image', upload.single('image'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'No file' })
  try {
    const projectId = await resolveProjectId(req)
    const record = await storeDiskFile(file.path, {
      projectId,
      originalName: file.originalname,
      mimeType: file.mimetype
    })
    return res.json({
      id: record.id,
      url: record.url,
      mimeType: record.mime_type,
      size: record.size_bytes
    })
  } catch (err) {
    console.error('[upload] failed to store file', err)
    return res.status(500).json({ error: 'Failed to store file' })
  }
})

export default router
