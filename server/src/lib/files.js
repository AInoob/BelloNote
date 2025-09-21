import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

import { db } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const uploadDir = path.join(__dirname, '../uploads')
const DATA_URI_RE = /^data:([^;,]+);base64,(.*)$/i
const EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm'
}

const selectByHash = db.prepare(`SELECT id, project_id, stored_name, original_name, mime_type, size_bytes, hash, created_at FROM files WHERE hash = ?`)
const selectById = db.prepare(`SELECT id, project_id, stored_name, original_name, mime_type, size_bytes, hash, created_at FROM files WHERE id = ?`)
const insertFile = db.prepare(`INSERT INTO files (project_id, stored_name, original_name, mime_type, size_bytes, hash) VALUES (?, ?, ?, ?, ?, ?)`)

export function ensureUploadDir() {
  try {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
  } catch (err) {
    console.error('[files] failed to ensure upload directory', err)
    throw err
  }
}

export function getUploadDir() {
  ensureUploadDir()
  return uploadDir
}

function extensionFromMime(mimeType, originalName = '') {
  const lower = String(mimeType || '').toLowerCase()
  if (EXTENSION_MAP[lower]) return EXTENSION_MAP[lower]
  const extFromName = path.extname(originalName || '').replace('.', '').toLowerCase()
  return extFromName || ''
}

function generateStoredName(extension) {
  const stamp = Date.now()
  const rand = crypto.randomBytes(6).toString('hex')
  const ext = extension ? `.${extension}` : ''
  return `${stamp}_${rand}${ext}`
}

const getFilePath = (storedName) => path.join(uploadDir, storedName)

function buildRecord(row) {
  if (!row) return null
  return { ...row, url: buildPublicUrl(row) }
}

export function buildPublicUrl(fileRow) {
  if (!fileRow) return null
  const name = encodeURIComponent(fileRow.stored_name)
  return `/files/${fileRow.id}/${name}`
}

function writeBufferToDisk(buffer, storedName) {
  ensureUploadDir()
  const filePath = getFilePath(storedName)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

function ensureExistingFile(row, buffer) {
  const filePath = getFilePath(row.stored_name)
  try {
    const stat = fs.statSync(filePath)
    if (stat.size === row.size_bytes) return row
  } catch {
    // fall through and rewrite missing/corrupt file
  }
  writeBufferToDisk(buffer, row.stored_name)
  return row
}

function sanitizeOriginalName(name) {
  if (!name) return null
  return path.basename(name).replace(/[^a-zA-Z0-9._\-]/g, '_')
}

export function storeBufferAsFile({ buffer, projectId, mimeType, originalName }) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('buffer required')
  const size = buffer.length
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const existing = selectByHash.get(hash)
  if (existing) {
    ensureExistingFile(existing, buffer)
    return buildRecord(existing)
  }
  const sanitizedOriginal = sanitizeOriginalName(originalName)
  const extension = extensionFromMime(mimeType, sanitizedOriginal)
  const storedName = generateStoredName(extension)
  writeBufferToDisk(buffer, storedName)
  const info = insertFile.run(projectId, storedName, sanitizedOriginal, mimeType || 'application/octet-stream', size, hash)
  const row = selectById.get(info.lastInsertRowid)
  return buildRecord(row)
}

export function storeDataUri(dataUri, { projectId, originalName } = {}) {
  if (!DATA_URI_RE.test(dataUri || '')) return null
  const match = DATA_URI_RE.exec(dataUri)
  if (!match) return null
  const mimeType = match[1]
  const base64 = match[2]
  try {
    const buffer = Buffer.from(base64, 'base64')
    return storeBufferAsFile({ buffer, projectId, mimeType, originalName })
  } catch (err) {
    console.error('[files] failed to decode data uri', err)
    return null
  }
}

export function storeDiskFile(filePath, { projectId, originalName, mimeType } = {}) {
  const abs = path.resolve(filePath)
  const buffer = fs.readFileSync(abs)
  const record = storeBufferAsFile({ buffer, projectId, mimeType, originalName })
  try { fs.unlinkSync(abs) } catch {}
  return record
}

export function getFileById(id) {
  const row = selectById.get(id)
  return buildRecord(row)
}

export function getDiskPathForFile(row) {
  if (!row) return null
  return getFilePath(row.stored_name)
}

export function isDataUri(value) {
  return DATA_URI_RE.test(String(value || ''))
}
