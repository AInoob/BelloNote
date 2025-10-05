import fs from 'fs/promises'
import path from 'path'
import { randomUUID, createHash } from 'crypto'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import mime from 'mime-types'

import { db, transaction } from './db.js'
import { ensureDefaultProject } from './projects.js'
import { storeBufferAsFile } from './files.js'
import { parseMaybeJson, stringifyNodes } from './richtext.js'
import { computeTaskTags } from '../util/tags.js'

const ASSET_SCHEME = 'asset://'
const DEFAULT_SCHEMA_PATH = path.join(process.cwd(), 'manifest.schema.json')

let compiledValidator = null
let compiledSchemaPath = null

async function readJson(filePath) {
  const data = await fs.readFile(filePath, 'utf8')
  return JSON.parse(data)
}

function uniqueSortedDates(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(v => String(v))))
    .sort()
}

function normalizeContentFormat(value) {
  const normalized = String(value || '').toLowerCase()
  return ['json', 'markdown', 'html', 'plaintext'].includes(normalized) ? normalized : 'json'
}

async function ensureFileForAsset(asset, projectId, cache) {
  if (!asset || !asset.id) return null
  if (cache.has(asset.id)) return cache.get(asset.id)
  const { dataBase64 = '', filename = 'asset', mimeType = 'application/octet-stream', sha256 = '' } = asset
  if (!dataBase64) throw new Error(`Asset ${asset.id} missing dataBase64`)
  let buffer
  try {
    buffer = Buffer.from(dataBase64, 'base64')
  } catch (err) {
    throw new Error(`Asset ${asset.id} failed base64 decode: ${err.message}`)
  }
  if (asset.bytes != null && Number(asset.bytes) !== buffer.length) {
    throw new Error(`Asset ${asset.id} byte length mismatch`)
  }
  if (sha256) {
    const digest = createHash('sha256').update(buffer).digest('hex')
    if (digest !== sha256) {
      throw new Error(`Asset ${asset.id} sha256 mismatch`)
    }
  }
  const guessedMime = mime.lookup(filename) || mimeType || 'application/octet-stream'
  const record = await storeBufferAsFile({
    buffer,
    projectId,
    mimeType: guessedMime,
    originalName: filename
  })
  cache.set(asset.id, record)
  return record
}

async function rewriteNodeForImport(node, resolveAsset) {
  if (!node || typeof node !== 'object') return node
  const copy = { ...node }
  if (copy.attrs) copy.attrs = { ...copy.attrs }
  if (copy.type === 'image') {
    const attrs = copy.attrs || {}
    const srcValue = attrs.src || attrs['data-asset-id'] || attrs['data-file-path'] || ''
    const assetId = typeof srcValue === 'string' && srcValue.startsWith(ASSET_SCHEME)
      ? srcValue.slice(ASSET_SCHEME.length)
      : (typeof attrs['data-asset-id'] === 'string' ? attrs['data-asset-id'] : null)
    if (assetId) {
      const record = await resolveAsset(assetId)
      if (record) {
        copy.attrs = {
          ...attrs,
          src: record.url,
          'data-file-id': String(record.id),
          'data-file-path': record.url
        }
        delete copy.attrs['data-asset-id']
      }
    }
  }
  if (Array.isArray(copy.content)) {
    const next = []
    for (const child of copy.content) {
      // eslint-disable-next-line no-await-in-loop
      next.push(await rewriteNodeForImport(child, resolveAsset))
    }
    copy.content = next
  }
  return copy
}

async function rewriteNodesForImport(nodes, resolveAsset) {
  if (!Array.isArray(nodes)) return []
  const rewritten = []
  for (const node of nodes) {
    // eslint-disable-next-line no-await-in-loop
    rewritten.push(await rewriteNodeForImport(node, resolveAsset))
  }
  return rewritten
}

async function rewriteContentForImport(note, resolveAsset) {
  const format = normalizeContentFormat(note.contentFormat)
  const raw = note.content || ''
  if (format === 'json') {
    const nodes = parseMaybeJson(raw)
    const rewritten = await rewriteNodesForImport(nodes, resolveAsset)
    return stringifyNodes(rewritten)
  }
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const paragraph = {
    type: 'paragraph',
    content: [{ type: 'text', text }]
  }
  const rewritten = await rewriteNodesForImport([paragraph], resolveAsset)
  return stringifyNodes(rewritten)
}

function buildChildrenMap(notes) {
  const map = new Map()
  for (const note of notes) {
    const parentId = note.parentId || null
    if (!map.has(parentId)) map.set(parentId, [])
    map.get(parentId).push(note)
  }
  for (const children of map.values()) {
    children.sort((a, b) => {
      const posA = a.position ?? 0
      const posB = b.position ?? 0
      if (posA !== posB) return posA - posB
      return String(a.id).localeCompare(String(b.id))
    })
  }
  return map
}

async function insertNoteTree({
  parentId,
  note,
  childrenMap,
  resolveAsset,
  projectId,
  tx,
  idMap,
  positionOverride
}) {
  const newId = randomUUID()
  idMap.set(note.id, newId)
  const contentJson = await rewriteContentForImport(note, resolveAsset)
  const nodes = parseMaybeJson(contentJson)
  const tags = new Set((note.tags || []).map(tag => String(tag || '').toLowerCase()))
  computeTaskTags({
    title: note.title || 'Untitled',
    nodes
  }).forEach(tag => tags.add(tag))
  const tagsJson = JSON.stringify(Array.from(tags).sort())
  const workedDates = uniqueSortedDates(note.workedDates)
  const firstDate = workedDates[0] || null
  const lastDate = workedDates.length ? workedDates[workedDates.length - 1] : null
  const positionValue = positionOverride != null
    ? Number(positionOverride)
    : (note.position == null ? 0 : Number(note.position))

  await tx.run(
    `INSERT INTO tasks (id, project_id, parent_id, title, status, content, tags, position, worked_dates, first_work_date, last_work_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13)`,
    [
      newId,
      projectId,
      parentId,
      note.title || 'Untitled',
      (note.status || '').trim(),
      contentJson,
      tagsJson,
      positionValue,
      JSON.stringify(workedDates),
      firstDate,
      lastDate,
      note.createdAt ? new Date(note.createdAt) : new Date(),
      note.updatedAt ? new Date(note.updatedAt) : new Date()
    ]
  )

  const children = childrenMap.get(note.id) || []
  for (let idx = 0; idx < children.length; idx += 1) {
    const child = children[idx]
    // Ensure child knows its position when missing
    // eslint-disable-next-line no-await-in-loop
    await insertNoteTree({
      parentId: newId,
      note: child,
      childrenMap,
      resolveAsset,
      projectId,
      tx,
      idMap,
      positionOverride: child.position == null ? idx : Number(child.position)
    })
  }
}

export async function importManifest({ manifestPath, schemaPath = DEFAULT_SCHEMA_PATH, projectId }) {
  if (!manifestPath) throw new Error('manifestPath required')
  const manifest = await readJson(manifestPath)

  if (!compiledValidator || compiledSchemaPath !== schemaPath) {
    const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'))
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    compiledValidator = ajv.compile(schema)
    compiledSchemaPath = schemaPath
  }

  if (!compiledValidator(manifest)) {
    const errors = (compiledValidator.errors || []).slice(0, 3).map(err => `${err.instancePath} ${err.message}`)
    throw new Error(`Manifest validation failed: ${errors.join('; ')}`)
  }

  const project = projectId || await ensureDefaultProject()
  const notes = Array.isArray(manifest?.entities?.notes) ? manifest.entities.notes : []
  const assetsList = Array.isArray(manifest?.assets) ? manifest.assets : []
  const assetMap = new Map()
  assetsList.forEach(asset => {
    if (asset?.id) assetMap.set(String(asset.id), asset)
  })

  const fileCache = new Map()
  async function resolveAsset(assetId) {
    if (!assetId) return null
    if (!assetMap.has(assetId)) throw new Error(`Unknown asset reference: ${assetId}`)
    if (fileCache.has(assetId)) return fileCache.get(assetId)
    const asset = assetMap.get(assetId)
    const record = await ensureFileForAsset(asset, project, fileCache)
    fileCache.set(assetId, record)
    return record
  }

  const childrenMap = buildChildrenMap(notes)
  const roots = childrenMap.get(null) || []
  const idMap = new Map()
  const summary = {
    notesImported: 0,
    assetsProcessed: 0,
    projectId: project
  }

  const positionRows = await db.all(
    `SELECT parent_id, MAX(position) AS max_position
       FROM tasks
      WHERE project_id = $1
      GROUP BY parent_id`,
    [project]
  )
  const maxPositionByParent = new Map()
  for (const row of positionRows) {
    const key = row.parent_id ? String(row.parent_id) : '__root__'
    const value = Number(row.max_position)
    maxPositionByParent.set(key, Number.isFinite(value) ? value : -1)
  }

  await transaction(async (tx) => {
    let rootBase = (maxPositionByParent.get('__root__') ?? -1) + 1
    for (let idx = 0; idx < roots.length; idx += 1) {
      const root = roots[idx]
      const rootPosition = rootBase + idx
      // eslint-disable-next-line no-await-in-loop
      await insertNoteTree({
        parentId: null,
        note: root,
        childrenMap,
        resolveAsset,
        projectId: project,
        tx,
        idMap,
        positionOverride: rootPosition
      })
    }
  })

  summary.notesImported = idMap.size
  summary.assetsProcessed = fileCache.size
  return summary
}
