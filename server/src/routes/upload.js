
import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadDir = path.join(__dirname, '../uploads')

export function ensureUploadDir() {
  try {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
  } catch {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => { ensureUploadDir(); cb(null, uploadDir) },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    cb(null, `${Date.now()}_${safe}`)
  }
})
const upload = multer({ storage })
const router = Router()

router.post('/image', upload.single('image'), (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'No file' })
  res.json({ url: `/uploads/${file.filename}` })
})

export default router
