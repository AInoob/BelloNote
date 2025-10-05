import fs from 'fs/promises'
import crypto from 'crypto'

import { db } from './db.js'
import { parseMaybeJson, stringifyNodes } from './richtext.js'
import { parseTagsField } from '../util/tags.js'
import { getFileById, getDiskPathForFile } from './files.js'

const FILE_PATH_RE = /\/(?:files)\/(\d+)\//i
const ASSET_SCHEME = 'asset://'

function extractFileId(value) {
  if (!value) return null
  const match = FILE_PATH_RE.exec(String(value))
  if (!match) return null
  return match[1]
}

function normalizeWorkedDates(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String)
    } catch {}
  }
  return []
}

function cloneNode(node) {
  if (!node || typeof node !== 'object') return node
  const copy = { ...node }
  if (copy.attrs) copy.attrs = { ...copy.attrs }
  if (Array.isArray(copy.content)) copy.content = copy.content.map(child => cloneNode(child))
  return copy
}

async function rewriteNodeForExport(node, ensureAsset) {
  if (!node || typeof node !== 'object') return node
  const copy = cloneNode(node)
  if (copy.type === 'image') {
    const attrs = copy.attrs || {}
    const rawId = attrs['data-file-id'] || extractFileId(attrs.src) || extractFileId(attrs['data-file-path'])
    if (rawId) {
      const asset = await ensureAsset(String(rawId))
      if (asset) {
        copy.attrs = { ...attrs, src: `${ASSET_SCHEME}${asset.id}`, 'data-asset-id': asset.id }
        delete copy.attrs['data-file-id']
        delete copy.attrs['data-file-path']
      }
    }
  }
  if (Array.isArray(copy.content)) {
    const next = []
    for (const child of copy.content) {
      next.push(await rewriteNodeForExport(child, ensureAsset))
    }
    copy.content = next
  }
  return copy
}

async function rewriteNodesForExport(nodes, ensureAsset) {
  if (!Array.isArray(nodes)) return nodes
  const rewritten = []
  for (const node of nodes) {
    rewritten.push(await rewriteNodeForExport(node, ensureAsset))
  }
  return rewritten
}

async function rewriteHtmlForExport(html, ensureAsset) {
  if (typeof html !== 'string' || !html) return html
  const attrRe = /(src|data-file-path)=(['"])([^'"\s>]+)\2/gi
  let lastIndex = 0
  let result = ''
  let match
  while ((match = attrRe.exec(html)) !== null) {
    const [full, attr, quote, value] = match
    const fileId = extractFileId(value)
    result += html.slice(lastIndex, match.index)
    if (fileId) {
      // eslint-disable-next-line no-await-in-loop
      const asset = await ensureAsset(String(fileId))
      if (asset) {
        result += `${attr}=${quote}${ASSET_SCHEME}${asset.id}${quote}`
      } else {
        result += full
      }
    } else {
      result += full
    }
    lastIndex = attrRe.lastIndex
  }
  result += html.slice(lastIndex)
  return result
}

function normalizeTimestamp(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) return date.toISOString()
  return String(value)
}

function sanitizeFilename(record) {
  if (!record) return 'file'
  return record.original_name || record.stored_name || `file-${record.id}`
}

export async function buildExportManifest({ projectId }) {
  if (!projectId) throw new Error('projectId required for export')

  const tasks = await db.all(
    `SELECT id, project_id, parent_id, title, status, content, tags, position, worked_dates, created_at, updated_at
       FROM tasks
      WHERE project_id = $1
      ORDER BY COALESCE(position, 0) ASC, created_at ASC, id ASC`,
    [projectId]
  )

  const assetByHash = new Map()
  const assetByFileId = new Map()
  const assets = []

  async function ensureAssetForFile(fileId) {
    if (assetByFileId.has(fileId)) return assetByFileId.get(fileId)
    const record = await getFileById(Number(fileId))
    if (!record || record.project_id !== Number(projectId)) return null
    const hash = record.hash || ''
    if (hash && assetByHash.has(hash)) {
      const existing = assetByHash.get(hash)
      assetByFileId.set(fileId, existing)
      return existing
    }
    const diskPath = getDiskPathForFile(record)
    let buffer
    try {
      buffer = await fs.readFile(diskPath)
    } catch (err) {
      console.error('[export] failed to read asset from disk', { fileId, diskPath, error: err?.message })
      return null
    }
    const sha256 = hash || crypto.createHash('sha256').update(buffer).digest('hex')
    const assetId = `asset_${sha256.slice(0, 16)}`
    const asset = {
      id: assetId,
      filename: sanitizeFilename(record),
      mimeType: record.mime_type || 'application/octet-stream',
      bytes: buffer.length,
      sha256,
      dataBase64: buffer.toString('base64')
    }
    assets.push(asset)
    assetByFileId.set(fileId, asset)
    if (hash) assetByHash.set(hash, asset)
    else assetByHash.set(sha256, asset)
    return asset
  }

  const notes = []
  const tagMap = new Map()

  for (const task of tasks) {
    const tags = parseTagsField(task.tags)
    tags.forEach((name) => {
      if (!tagMap.has(name)) tagMap.set(name, { id: `tag_${name}`, name })
    })

    const rawContent = task.content
    const trimmed = typeof rawContent === 'string' ? rawContent.trim() : ''
    let contentFormat = 'plaintext'
    let processedContent = ''

    if (Array.isArray(rawContent) || trimmed.startsWith('[')) {
      const nodes = parseMaybeJson(rawContent)
      const rewrittenNodes = await rewriteNodesForExport(nodes, ensureAssetForFile)
      processedContent = stringifyNodes(rewrittenNodes)
      contentFormat = 'json'
    } else if (typeof rawContent === 'string') {
      processedContent = await rewriteHtmlForExport(rawContent, ensureAssetForFile)
      contentFormat = 'html'
    } else {
      processedContent = rawContent ? JSON.stringify(rawContent) : ''
      contentFormat = 'plaintext'
    }

    notes.push({
      id: String(task.id),
      title: task.title || 'Untitled',
      contentFormat,
      content: processedContent,
      coverImage: null,
      tags,
      status: (task.status || '').trim(),
      parentId: task.parent_id ? String(task.parent_id) : null,
      position: task.position == null ? null : Number(task.position),
      workedDates: normalizeWorkedDates(task.worked_dates),
      createdAt: normalizeTimestamp(task.created_at) || new Date().toISOString(),
      updatedAt: normalizeTimestamp(task.updated_at) || normalizeTimestamp(task.created_at) || new Date().toISOString()
    })
  }

  const manifest = {
    app: 'BelloNote',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    entities: {
      notes,
      tags: Array.from(tagMap.values()),
      users: []
    },
    assets,
    meta: {
      projectId: Number(projectId),
      notesCount: notes.length,
      assetsCount: assets.length
    }
  }

  return manifest
}
