// server/src/scripts/export-timeline-html.js
// Usage:
//   node src/scripts/export-timeline-html.js --out dist/timeline.html [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--project <id>]
// Notes:
//   - Produces a single HTML file (no external CSS/JS).
//   - Images from /files/:id/... are embedded as base64 data URIs.
//   - Read-only: no TipTap, no editing JS.

import fs from 'fs/promises'
import path from 'path'
import dayjs from 'dayjs'
import { fileURLToPath } from 'url'

import { db } from '../lib/db.js'
import { parseMaybeJson } from '../lib/richtext.js'
import { getFileById, getDiskPathForFile } from '../lib/files.js'

// ------------ CLI ------------
const parsedArgs = new Map()
const includeTagArgs = []
const excludeTagArgs = []
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const key = arg.slice(2)
  let value = true
  if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
    value = process.argv[++i]
  }
  if (key === 'include-tag') {
    if (value !== true) includeTagArgs.push(String(value))
    continue
  }
  if (key === 'exclude-tag') {
    if (value !== true) excludeTagArgs.push(String(value))
    continue
  }
  parsedArgs.set(key, value)
}
const OUT_PATH = String(parsedArgs.get('out') || 'dist/timeline.html')
const RANGE_FROM = parsedArgs.get('from') ? String(parsedArgs.get('from')) : null
const RANGE_TO   = parsedArgs.get('to')   ? String(parsedArgs.get('to'))   : null
const PROJECT_ID = parsedArgs.get('project') ? Number(parsedArgs.get('project')) : null
const INCLUDE_TAGS = includeTagArgs.map((tag) => normalizeTagName(tag)).filter(Boolean)
const EXCLUDE_TAGS = excludeTagArgs.map((tag) => normalizeTagName(tag)).filter(Boolean)
const INCLUDE_TAGS_DISPLAY = includeTagArgs.filter((tag) => String(tag || '').trim() !== '')
const EXCLUDE_TAGS_DISPLAY = excludeTagArgs.filter((tag) => String(tag || '').trim() !== '')

// ------------ Helpers ------------
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function ensureOutDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function extractTagString(tag) {
  if (tag == null) return ''
  if (typeof tag === 'string') return tag
  if (typeof tag === 'object') {
    if (typeof tag.name === 'string') return tag.name
    if (typeof tag.label === 'string') return tag.label
    if (typeof tag.value === 'string') return tag.value
    if (typeof tag.value === 'number') return String(tag.value)
  }
  return String(tag)
}

function normalizeTagName(tag) {
  return extractTagString(tag).trim().toLowerCase()
}

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}

function withinRange(dateStr, from, to) {
  if (!isIsoDate(dateStr)) return false
  const d = dayjs(dateStr)
  if (from && d.isBefore(dayjs(from))) return false
  if (to && d.isAfter(dayjs(to))) return false
  return true
}

function uniqSorted(arr) {
  return Array.from(new Set(arr)).sort()
}

// ------------ DB Load ------------
function looksLikePlaywrightDb() {
  const dbName = (process.env.PGDATABASE || '').toLowerCase()
  return dbName.includes('bello_note_test') || dbName.includes('playwright')
}

async function resolveProjectId() {
  if (PROJECT_ID) return PROJECT_ID

  if (process.env.NODE_ENV === 'test' || looksLikePlaywrightDb()) {
    const testProject = await db.get('SELECT id FROM projects WHERE name = $1 ORDER BY id ASC LIMIT 1', ['Playwright E2E'])
    if (testProject?.id) return testProject.id
  }

  const row = await db.get('SELECT id FROM projects ORDER BY id ASC LIMIT 1')
  if (!row?.id) throw new Error('No project found. Seed or create a project first.')
  return row.id
}

async function loadTasks(projectId) {
  // Includes everything needed for timeline export
  const rows = await db.all(
    `SELECT id, parent_id, title, status, content, tags, worked_dates, position, created_at, updated_at
       FROM tasks
      WHERE project_id = $1
      ORDER BY COALESCE(position, 0) ASC, created_at ASC, id ASC`,
    [projectId]
  )
  return rows.map((r) => {
    const worked = normalizeJsonArray(r.worked_dates)
    const tags = normalizeJsonArray(r.tags)
    return {
      ...r,
      id: String(r.id),
      parent_id: r.parent_id ? String(r.parent_id) : null,
      worked_dates: worked,
      tags,
      position: r.position == null ? 0 : Number(r.position)
    }
  })
}

// Build parent chain for path display
function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {}
  }
  return []
}

function buildParentsMap(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  function pathFor(id) {
    const parts = []
    let cur = byId.get(id)
    const guard = new Set()
    while (cur && cur.parent_id && !guard.has(cur.id)) {
      guard.add(cur.id)
      cur = byId.get(cur.parent_id)
      if (cur) parts.push(cur.title || 'Untitled')
    }
    return parts.reverse()
  }
  return { byId, pathFor }
}

function buildChildrenMap(tasks) {
  const byParent = new Map()
  for (const task of tasks) {
    const key = task.parent_id || null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(task)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const pos = (a.position ?? 0) - (b.position ?? 0)
      if (pos !== 0) return pos
      const createdA = String(a.created_at || '')
      const createdB = String(b.created_at || '')
      if (createdA !== createdB) return createdA.localeCompare(createdB)
      return a.id.localeCompare(b.id)
    })
  }
  return byParent
}

// ------------ Base64 image inlining ------------
const FILE_URL_RE = /\/files\/(\d+)\//i

async function fileIdToDataUri(fileId) {
  const rec = await getFileById(Number(fileId))
  if (!rec) return null
  const diskPath = getDiskPathForFile(rec)
  const buf = await fs.readFile(diskPath)
  const b64 = buf.toString('base64')
  const mime = rec.mime_type || 'application/octet-stream'
  return `data:${mime};base64,${b64}`
}

async function inlineImgUrlMaybe(src, attrs = {}) {
  if (!src) return null
  // Prefer explicit data-file-id if present
  if (attrs && attrs['data-file-id']) {
    const data = await fileIdToDataUri(attrs['data-file-id'])
    return data || src
  }
  // Otherwise try to parse from /files/:id/...
  const m = FILE_URL_RE.exec(String(src))
  if (!m) return src
  const data = await fileIdToDataUri(m[1])
  return data || src
}

// ------------ TipTap-JSON -> HTML serializer (minimal) ------------
function serializeMarks(text, marks = []) {
  let out = escapeHtml(text)
  if (!Array.isArray(marks) || marks.length === 0) return out

  // Link should be outermost wrapper to preserve href on all nested styles.
  const byType = new Map()
  for (const m of marks) {
    if (!m?.type) continue
    if (!byType.has(m.type)) byType.set(m.type, [])
    byType.get(m.type).push(m)
  }

  // Deterministic order
  const order = ['link', 'bold', 'strong', 'italic', 'em', 'underline', 'strike', 'code']
  for (const t of order) {
    const list = byType.get(t) || []
    for (const m of list) {
      switch (m.type) {
        case 'link': {
          const href = escapeHtml(m.attrs?.href || '')
          const rel = 'noopener noreferrer'
          const target = '_blank'
          out = `<a href="${href}" target="${target}" rel="${rel}">${out}</a>`
          break
        }
        case 'bold':
        case 'strong':
          out = `<strong>${out}</strong>`
          break
        case 'italic':
        case 'em':
          out = `<em>${out}</em>`
          break
        case 'underline':
          out = `<u>${out}</u>`
          break
        case 'strike':
          out = `<s>${out}</s>`
          break
        case 'code':
          out = `<code>${out}</code>`
          break
      }
    }
  }
  return out
}

async function serializeNode(node) {
  if (!node || typeof node !== 'object') return ''
  const type = node.type

  switch (type) {
    case 'text':
      return serializeMarks(node.text || '', node.marks)

    case 'hardBreak':
    case 'hard_break':
      return '<br/>'

    case 'paragraph': {
      const inner = await serializeChildren(node)
      return inner ? `<p>${inner}</p>` : '<p></p>'
    }

    case 'heading': {
      const level = Number(node.attrs?.level || 1)
      const inner = await serializeChildren(node)
      const tag = `h${Math.max(1, Math.min(6, level))}`
      return `<${tag}>${inner}</${tag}>`
    }

    case 'bulletList':
    case 'bullet_list': {
      const inner = await serializeChildren(node)
      return `<ul>${inner}</ul>`
    }

    case 'orderedList':
    case 'ordered_list': {
      const start = node.attrs?.start ? ` start="${Number(node.attrs.start)}"` : ''
      const inner = await serializeChildren(node)
      return `<ol${start}>${inner}</ol>`
    }

    case 'listItem':
    case 'list_item': {
      const inner = await serializeChildren(node)
      return `<li>${inner}</li>`
    }

    case 'blockquote': {
      const inner = await serializeChildren(node)
      return `<blockquote>${inner}</blockquote>`
    }

    case 'horizontalRule':
    case 'horizontal_rule':
      return '<hr/>'

    case 'codeBlock':
    case 'code_block': {
      const text = (Array.isArray(node.content) ? node.content : [])
        .map(n => (n.type === 'text' ? n.text : ''))
        .join('')
      return `<pre><code>${escapeHtml(text)}</code></pre>`
    }

    case 'image': {
      const attrs = node.attrs || {}
      const src = await inlineImgUrlMaybe(attrs.src, attrs)
      const alt = escapeHtml(attrs.alt || '')
      const title = escapeHtml(attrs.title || '')
      const titleAttr = title ? ` title="${title}"` : ''
      const altAttr = ` alt="${alt}"`
      const srcAttr = src ? ` src="${src}"` : ''
      return `<img${srcAttr}${altAttr}${titleAttr}/>`
    }

    default: {
      // Fallback: serialize children only
      return await serializeChildren(node)
    }
  }
}

async function serializeChildren(node) {
  if (!Array.isArray(node?.content) || node.content.length === 0) return ''
  const parts = []
  for (const c of node.content) parts.push(await serializeNode(c))
  return parts.join('')
}

async function nodesToHtml(nodes) {
  const root = { type: 'doc', content: Array.isArray(nodes) ? nodes : [] }
  const inner = await serializeChildren(root)
  return inner
}

// ------------ HTML content (string) -> inline images ------------
async function inlineImagesInHtml(html) {
  if (typeof html !== 'string' || !html) return html

  // Replace img tags one-by-one to allow async file reads.
  const IMG_RE = /<img\b([^>]*?)>/gi

  let out = ''
  let lastIndex = 0
  let match
  while ((match = IMG_RE.exec(html)) !== null) {
    out += html.slice(lastIndex, match.index)
    const tag = match[0]
    const attrs = match[1] || ''

    // Extract src and data-file-id
    const srcMatch = /\ssrc=(["'])(.*?)\1/i.exec(attrs)
    const idMatch = /\sdata-file-id=(["'])(\d+)\1/i.exec(attrs)

    const src = srcMatch ? srcMatch[2] : ''
    const dataFileId = idMatch ? idMatch[2] : null

    const inlined = await inlineImgUrlMaybe(src, dataFileId ? { 'data-file-id': dataFileId } : {})
    if (!inlined || inlined === src) {
      out += tag
    } else {
      // Rebuild tag with new src and remove any previous data-file-* attrs
      const cleanedAttrs = attrs
        .replace(/\sdata-file-id=(["'])(.*?)\1/ig, '')
        .replace(/\sdata-file-path=(["'])(.*?)\1/ig, '')
        .replace(/\ssrc=(["'])(.*?)\1/ig, '')
      out += `<img src="${inlined}"${cleanedAttrs}>`
    }
    lastIndex = IMG_RE.lastIndex
  }
  out += html.slice(lastIndex)
  return out
}

// ------------ Timeline grouping ------------
function collectAllDates(tasks, matchSet = null) {
  const all = []
  for (const t of tasks) {
    if (matchSet && !matchSet.has(t.id)) continue
    for (const d of t.worked_dates) {
      if (isIsoDate(d)) all.push(d)
    }
  }
  return uniqSorted(all)
}

function pickDatesInRange(all, from, to) {
  if (!from && !to) return all
  return all.filter(d => withinRange(d, from, to))
}

function tasksByDate(tasks, matchSet = null) {
  const map = new Map()
  for (const task of tasks) {
    if (matchSet && !matchSet.has(task.id)) continue
    for (const raw of task.worked_dates) {
      if (!isIsoDate(raw)) continue
      if (!map.has(raw)) map.set(raw, [])
      map.get(raw).push(task)
    }
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      const pos = (a.position ?? 0) - (b.position ?? 0)
      if (pos !== 0) return pos
      return a.id.localeCompare(b.id)
    })
  }
  return map
}

function formatDate(d) {
  return dayjs(d).format('ddd, MMM D, YYYY')
}

// ------------ Render full document ------------
function baseCss() {
  return `
:root {
  --bg: #ffffff;
  --fg: #111827;
  --muted: #6B7280;
  --border: #E5E7EB;
  --accent: #2563EB;
  --badge-bg: #EEF2FF;
  --badge-fg: #1D4ED8;
  --node-bg: #F9FAFB;
  --node-border: rgba(148, 163, 184, 0.35);
  --date-active-bg: rgba(37, 99, 235, 0.16);
  --date-active-fg: #1D4ED8;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.6 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.container { max-width: 960px; margin: 40px auto; padding: 0 28px 64px; }
.header { margin-bottom: 34px; }
.header h1 { margin: 0 0 6px; font-size: 28px; font-weight: 600; }
.header .meta { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
.day { margin: 28px 0 44px; }
.day h2 { font-size: 15px; font-weight: 600; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 18px; }
.day-tree,
.day-tree ul { list-style: none; padding-left: 0; margin: 0; }
.day-tree > li { margin-bottom: 12px; }
.day-tree li {
  position: relative;
  padding-left: 16px;
  margin-bottom: 10px;
}
.day-tree li::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 0.9em;
  width: 8px;
  height: 1px;
  background: var(--border);
}
.day-tree ul {
  margin-top: 6px;
  padding-left: 18px;
  border-left: 1px solid var(--border);
}
.node {
  background: var(--node-bg);
  border: 1px solid var(--node-border);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.05);
}
.node.active {
  background: #EEF2FF;
  border-color: rgba(37, 99, 235, 0.35);
  box-shadow: 0 16px 26px rgba(37, 99, 235, 0.12);
}
.node-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 6px;
}
.node-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--badge-bg);
  color: var(--badge-fg);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.dates {
  display: flex;
  gap: 6px;
  align-items: center;
}
.date-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--badge-bg);
  color: var(--badge-fg);
  font-size: 11px;
}
.date-chip.active {
  background: var(--date-active-bg);
  color: var(--date-active-fg);
  font-weight: 600;
}
.tags {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.content {
  margin: 8px 0 4px;
  color: var(--fg);
}
.content img { max-width: 100%; border-radius: 10px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.1); }
.content pre {
  background: #F5F7FB;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 12px 14px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.48;
}
.content code { font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace; }
.content p { margin: 10px 0; }
.empty-day {
  color: var(--muted);
  font-style: italic;
  margin: 0 0 12px;
  padding: 6px 0 0 12px;
}
  `.trim()
}

function renderHeader({ title, from, to, projectId, exportedAt, dateCount, tagSummary }) {
  const metaParts = [`Project #${projectId}`]
  if (from || to) {
    metaParts.push(`Range: ${from || '…'} → ${to || '…'}`)
  }
  metaParts.push(`${dateCount} day(s)`)
  if (tagSummary) metaParts.push(tagSummary)
  metaParts.push(`Exported ${exportedAt}`)
  const metaLine = metaParts.map(escapeHtml).join(' • ')
  return `
  <header class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${metaLine}</div>
  </header>
  `
}

async function renderTaskContent(task) {
  // Task content can be TipTap JSON (stringified) or a raw string (HTML/plain).
  const nodes = parseMaybeJson(task.content)
  if (Array.isArray(nodes) && nodes.length > 0) {
    const html = await nodesToHtml(nodes)
    if (isRedundantContent(html, extractPlainText(nodes), task.title)) return ''
    return `<div class="content">${html}</div>`
  }

  const raw = typeof task.content === 'string' ? task.content : ''
  if (!raw) return ''
  const withInlined = await inlineImagesInHtml(raw)
  if (isRedundantContent(withInlined, stripHtmlToText(withInlined), task.title)) return ''
  return `<div class="content">${withInlined}</div>`
}

function extractPlainText(node) {
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractPlainText).join(' ')
  if (typeof node === 'string') return node
  if (node.type === 'text') return node.text || ''
  if (Array.isArray(node.content)) return node.content.map(extractPlainText).join(' ')
  return ''
}

function stripHtmlToText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeForComparison(value) {
  return String(value || '')
    .replace(/@\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\[[^[\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const STATUS_WORDS = ['todo', 'done', 'in-progress', 'in progress', 'blocked', 'hold', 'on hold']

function stripStatusWords(value) {
  let output = value
  for (const status of STATUS_WORDS) {
    const pattern = new RegExp(`\\b${status.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'ig')
    output = output.replace(pattern, ' ')
  }
  return output.replace(/\s+/g, ' ').trim()
}

function computeMatchingTaskIds(tasks, includeSet, excludeSet) {
  const ids = new Set()
  for (const task of tasks) {
    const taskTags = (Array.isArray(task.tags) ? task.tags : []).map(normalizeTagName).filter(Boolean)
    if (excludeSet.size && taskTags.some((tag) => excludeSet.has(tag))) continue
    if (includeSet.size && !taskTags.some((tag) => includeSet.has(tag))) continue
    ids.add(task.id)
  }
  return ids
}

function isRedundantContent(html, plainText, title) {
  const normalizedBody = stripStatusWords(normalizeForComparison(plainText || stripHtmlToText(html)))
  const normalizedTitle = stripStatusWords(normalizeForComparison(title))
  if (!normalizedBody) return true
  return normalizedBody === normalizedTitle
}

async function renderNode(task, { activeDate, includeSet, childrenMap }) {
  const status = (task.status || '').trim()
  const tags = Array.isArray(task.tags) ? task.tags : []
  const isActive = task.worked_dates.includes(activeDate)
  const parts = ['<li>']
  parts.push(`<div class="node${isActive ? ' active' : ''}">`)
  const statusBadge = status ? `<span class="status-badge">${escapeHtml(status)}</span>` : ''
  const dateChips = task.worked_dates.map((date) => {
    const cls = date === activeDate ? 'date-chip active' : 'date-chip'
    return `<span class="${cls}">@${escapeHtml(date)}</span>`
  }).join('')
  const datesHtml = dateChips ? `<div class="dates">${dateChips}</div>` : ''
  const displayTags = tags.map((tag) => extractTagString(tag)).filter((value) => value && value.trim() !== '')
  const tagsHtml = displayTags.length ? `<div class="tags">${displayTags.map((t) => `#${escapeHtml(t.trim())}`).join(' ')}</div>` : ''
  parts.push(`
    <div class="node-header">
      <span class="node-title">${escapeHtml(task.title || 'Untitled')}</span>
      ${statusBadge}
      ${datesHtml}
      ${tagsHtml}
    </div>
  `)
  if (isActive) {
    const content = await renderTaskContent(task)
    if (content) parts.push(content)
  }
  parts.push('</div>')

  const children = childrenMap.get(task.id) || []
  const visible = children.filter((child) => includeSet.has(child.id))
  if (visible.length) {
    parts.push('<ul>')
    for (const child of visible) {
      parts.push(await renderNode(child, { activeDate, includeSet, childrenMap }))
    }
    parts.push('</ul>')
  }

  parts.push('</li>')
  return parts.join('\n')
}

async function buildHtml({
  projectId,
  tasks,
  from,
  to,
  includeTags = [],
  excludeTags = [],
  includeTagsDisplay = [],
  excludeTagsDisplay = [],
  includeTagSet: providedIncludeSet = null,
  excludeTagSet: providedExcludeSet = null,
  matchingTaskIds: providedMatchingIds = null
}) {
  const { byId } = buildParentsMap(tasks)
  const childrenMap = buildChildrenMap(tasks)
  const rootChildren = childrenMap.get(null) || []
  const includeTagSet = providedIncludeSet
    ? new Set([...providedIncludeSet].map(normalizeTagName))
    : new Set(includeTags.map(normalizeTagName))
  const excludeTagSet = providedExcludeSet
    ? new Set([...providedExcludeSet].map(normalizeTagName))
    : new Set(excludeTags.map(normalizeTagName))
  const matchingTaskIds = providedMatchingIds
    ? new Set(providedMatchingIds)
    : computeMatchingTaskIds(tasks, includeTagSet, excludeTagSet)

  const allDates = collectAllDates(tasks, matchingTaskIds)
  const dateList = pickDatesInRange(allDates, from, to)
  const byDate = tasksByDate(tasks, matchingTaskIds)

  const exportedAt = new Date().toISOString()
  const includeSummaryList = includeTagsDisplay.length ? includeTagsDisplay : Array.from(includeTagSet)
  const excludeSummaryList = excludeTagsDisplay.length ? excludeTagsDisplay : Array.from(excludeTagSet)
  const tagSummaryParts = []
  if (includeSummaryList.length) tagSummaryParts.push(`include ${includeSummaryList.join(', ')}`)
  if (excludeSummaryList.length) tagSummaryParts.push(`exclude ${excludeSummaryList.join(', ')}`)
  const tagSummary = tagSummaryParts.length ? `Tags ${tagSummaryParts.join(' ; ')}` : ''

  const chunks = []
  chunks.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`)
  chunks.push(`<meta name="viewport" content="width=device-width, initial-scale=1">`)
  chunks.push(`<meta name="generator" content="BelloNote Timeline Export">`)
  chunks.push(`<title>Timeline Export</title><style>${baseCss()}</style></head><body>`)
  chunks.push(`<div class="container">`)
  chunks.push(renderHeader({
    title: 'Timeline',
    from, to, projectId, exportedAt,
    dateCount: dateList.length,
    tagSummary
  }))

  for (const d of dateList) {
    const items = byDate.get(d) || []
    chunks.push(`<section class="day">`)
    chunks.push(`<h2>${escapeHtml(formatDate(d))}</h2>`)

    if (!items.length) {
      chunks.push('<p class="empty-day">No entries for this date.</p>')
      chunks.push(`</section>`)
      continue
    }

    const includeSet = new Set()
    for (const task of items) {
      let current = task
      const guard = new Set()
      while (current && !guard.has(current.id)) {
        guard.add(current.id)
        includeSet.add(current.id)
        current = current.parent_id ? byId.get(current.parent_id) : null
      }
    }

    const renderChildren = async (nodes) => {
      const visible = nodes.filter((child) => includeSet.has(child.id))
      if (!visible.length) return ''
      const parts = ['<ul class="day-tree">']
      for (const child of visible) {
        parts.push(await renderNode(child, { activeDate: d, includeSet, childrenMap }))
      }
      parts.push('</ul>')
      return parts.join('\n')
    }

    const treeHtml = await renderChildren(rootChildren)
    chunks.push(treeHtml || '<p class="empty-day">Nothing recorded for this day.</p>')

    chunks.push(`</section>`)
  }

  chunks.push(`</div></body></html>`)
  return chunks.join('\n')
}

// ------------ Main ------------
async function main() {
  const projectId = await resolveProjectId()
  const tasks = await loadTasks(projectId)

  let from = RANGE_FROM
  let to = RANGE_TO
  const includeTagSetForFilter = new Set(INCLUDE_TAGS)
  const excludeTagSetForFilter = new Set(EXCLUDE_TAGS)
  const matchingTaskIds = computeMatchingTaskIds(tasks, includeTagSetForFilter, excludeTagSetForFilter)

  // If no range provided, use min..max of worked_dates (if any)
  if (!from || !to) {
    const dates = collectAllDates(tasks, matchingTaskIds)
    if (dates.length) {
      from = from || dates[0]
      to = to || dates[dates.length - 1]
    }
  }

  const html = await buildHtml({
    projectId,
    tasks,
    from,
    to,
    includeTags: INCLUDE_TAGS,
   excludeTags: EXCLUDE_TAGS,
   includeTagsDisplay: INCLUDE_TAGS_DISPLAY,
    excludeTagsDisplay: EXCLUDE_TAGS_DISPLAY,
    includeTagSet: includeTagSetForFilter,
    excludeTagSet: excludeTagSetForFilter,
    matchingTaskIds
  })
  await ensureOutDir(OUT_PATH)
  await fs.writeFile(OUT_PATH, html, 'utf8')
  console.log(`[export] wrote ${OUT_PATH}`)
}

main().catch(err => {
  console.error('[export] failed:', err?.stack || err)
  process.exit(1)
})
