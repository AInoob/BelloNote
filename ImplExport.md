Great idea. You already have almost everything you need on the server side (Postgres, files table, and helpers to read files). Below is a **clean, single‑file Node script** + **package.json changes** that will export your **timeline** to a **single, self‑contained HTML file** (read‑only, with all `<img>` sources inlined as base64).

It does **not** add any web route; it’s a CLI you can run via `npm run ...`. It reuses your existing server code:

* DB access: `server/src/lib/db.js`
* File lookup / disk path: `server/src/lib/files.js`
* Content parsing: `server/src/lib/richtext.js` (for TipTap JSON vs string content)

It intentionally avoids TipTap in the export, and uses a minimal serializer to render TipTap‑style JSON into static HTML.

---

## 1) Add the npm command

In **`server/package.json`**, add two scripts (one simple, one with range):

```json
{
  "scripts": {
    "start": "node --max-old-space-size=1024 src/index.js",
    "dev": "nodemon src/index.js",
    "seed": "node src/seed.js",

    "export:timeline": "node src/scripts/export-timeline-html.js --out dist/timeline.html",
    "export:timeline:range": "node src/scripts/export-timeline-html.js --from 2025-01-01 --to 2025-10-11 --out dist/timeline.html"
  }
}
```

> The script respects your existing PG env vars (`DATABASE_URL`, `PG*`, etc.). It will create `dist/timeline.html` unless you pass a different `--out`.

---

## 2) Create the script

Create **`server/src/scripts/export-timeline-html.js`** (ESM). Paste this whole file:

```js
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
const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true
    args.set(k, v)
  }
}
const OUT_PATH = String(args.get('out') || 'dist/timeline.html')
const RANGE_FROM = args.get('from') ? String(args.get('from')) : null
const RANGE_TO   = args.get('to')   ? String(args.get('to'))   : null
const PROJECT_ID = args.get('project') ? Number(args.get('project')) : null

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
async function resolveProjectId() {
  if (PROJECT_ID) return PROJECT_ID
  // fall back to "default" project
  const row = await db.get('SELECT id FROM projects ORDER BY id ASC LIMIT 1')
  if (!row?.id) throw new Error('No project found. Seed or create a project first.')
  return row.id
}

async function loadTasks(projectId) {
  // Includes everything needed for timeline export
  const rows = await db.all(
    `SELECT id, parent_id, title, status, content, tags, worked_dates, created_at, updated_at
       FROM tasks
      WHERE project_id = $1
      ORDER BY COALESCE(position, 0) ASC, created_at ASC, id ASC`,
    [projectId]
  )
  return rows.map(r => ({
    ...r,
    worked_dates: Array.isArray(r.worked_dates) ? r.worked_dates : []
  }))
}

// Build parent chain for path display
function buildParentsMap(tasks) {
  const byId = new Map(tasks.map(t => [String(t.id), t]))
  function pathFor(id) {
    const parts = []
    let cur = byId.get(String(id))
    const guard = new Set()
    while (cur && cur.parent_id && !guard.has(cur.id)) {
      guard.add(cur.id)
      cur = byId.get(String(cur.parent_id))
      if (cur) parts.push(cur.title || 'Untitled')
    }
    return parts.reverse()
  }
  return { byId, pathFor }
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
function collectAllDates(tasks) {
  const all = []
  for (const t of tasks) {
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

function tasksByDate(tasks) {
  const map = new Map()
  for (const t of tasks) {
    for (const d of t.worked_dates) {
      if (!isIsoDate(d)) continue
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(t)
    }
  }
  // stable order inside a day
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      const pos = (a.position ?? 0) - (b.position ?? 0)
      if (pos !== 0) return pos
      const ca = String(a.id), cb = String(b.id)
      return ca.localeCompare(cb)
    })
  }
  return map
}

// ------------ Render full document ------------
function baseCss() {
  return `
:root {
  --bg: #101214;
  --fg: #E6E8EA;
  --muted: #9AA3AD;
  --accent: #4EA8DE;
  --border: #23272A;
  --chip: #1B1F24;
  --card: #14181B;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.container { max-width: 920px; margin: 32px auto; padding: 0 20px; }
.header { margin-bottom: 24px; }
.header h1 { margin: 0 0 6px; font-size: 22px; }
.header .meta { color: var(--muted); font-size: 12px; }
.day { margin: 24px 0 36px; }
.day h2 { font-size: 16px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; margin: 8px 0 12px; }
.item { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin: 10px 0; }
.item-header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; margin-bottom: 6px; }
.path { color: var(--muted); font-size: 12px; }
.title { font-weight: 600; }
.status { background: var(--chip); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; font-size: 12px; color: var(--muted); }
.tags { margin-left: auto; font-size: 12px; color: var(--muted); }
.content img { max-width: 100%; height: auto; border-radius: 6px; }
.content pre { background: #0b0d10; border: 1px solid var(--border); border-radius: 6px; padding: 10px; overflow: auto; }
.content code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.content h1,.content h2,.content h3 { margin: 10px 0 6px; }
.content p { margin: 8px 0; white-space: pre-wrap; }
hr { border: 0; border-top: 1px solid var(--border); margin: 12px 0; }
  `.trim()
}

function formatDate(d) {
  return dayjs(d).format('ddd, MMM D, YYYY') // e.g., Sat, Oct 11, 2025
}

function renderHeader({ title, from, to, projectId, exportedAt, dateCount }) {
  const subtitle = (from || to)
    ? `Range: ${from || '…'} → ${to || '…'} • ${dateCount} day(s)`
    : `${dateCount} day(s)`
  return `
  <header class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Project #${projectId} • ${escapeHtml(subtitle)} • Exported ${escapeHtml(exportedAt)}</div>
  </header>
  `
}

function renderItemHeader(task, pathTitles) {
  const status = (task.status || '').trim()
  const title = task.title || 'Untitled'
  const pathStr = pathTitles.length ? `${pathTitles.join(' / ')}` : ''
  const tags = (() => {
    try {
      const t = Array.isArray(task.tags) ? task.tags : JSON.parse(task.tags || '[]')
      if (!Array.isArray(t) || t.length === 0) return ''
      return t.map(v => `#${escapeHtml(String(v))}`).join(' ')
    } catch { return '' }
  })()

  return `
    <div class="item-header">
      ${pathStr ? `<div class="path">${escapeHtml(pathStr)}</div>` : ''}
      <div class="title">${escapeHtml(title)}</div>
      ${status ? `<div class="status">${escapeHtml(status)}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </div>
  `
}

async function renderTaskContent(task) {
  // Task content can be TipTap JSON (stringified) or a raw string (HTML/plain).
  const nodes = parseMaybeJson(task.content)
  if (Array.isArray(nodes) && nodes.length > 0) {
    const html = await nodesToHtml(nodes)
    return `<div class="content">${html}</div>`
  }

  const raw = typeof task.content === 'string' ? task.content : ''
  if (!raw) return ''
  const withInlined = await inlineImagesInHtml(raw)
  return `<div class="content">${withInlined}</div>`
}

async function buildHtml({ projectId, tasks, from, to }) {
  const { pathFor } = buildParentsMap(tasks)
  const allDates = collectAllDates(tasks)
  const dateList = pickDatesInRange(allDates, from, to)
  const byDate = tasksByDate(tasks)

  const exportedAt = new Date().toISOString()

  const chunks = []
  chunks.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`)
  chunks.push(`<meta name="viewport" content="width=device-width, initial-scale=1">`)
  chunks.push(`<meta name="generator" content="BelloNote Timeline Export">`)
  chunks.push(`<title>Timeline Export</title><style>${baseCss()}</style></head><body>`)
  chunks.push(`<div class="container">`)
  chunks.push(renderHeader({
    title: 'Timeline',
    from, to, projectId, exportedAt,
    dateCount: dateList.length
  }))

  for (const d of dateList) {
    const items = byDate.get(d) || []
    if (!items.length) continue

    chunks.push(`<section class="day">`)
    chunks.push(`<h2>${escapeHtml(formatDate(d))}</h2>`)

    for (const t of items) {
      const pathTitles = pathFor(t.id)
      chunks.push(`<article class="item">`)
      chunks.push(renderItemHeader(t, pathTitles))
      chunks.push(await renderTaskContent(t))
      chunks.push(`</article>`)
    }

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

  // If no range provided, use min..max of worked_dates (if any)
  if (!from || !to) {
    const dates = collectAllDates(tasks)
    if (dates.length) {
      from = from || dates[0]
      to = to || dates[dates.length - 1]
    }
  }

  const html = await buildHtml({ projectId, tasks, from, to })
  await ensureOutDir(OUT_PATH)
  await fs.writeFile(OUT_PATH, html, 'utf8')
  console.log(`[export] wrote ${OUT_PATH}`)
}

main().catch(err => {
  console.error('[export] failed:', err?.stack || err)
  process.exit(1)
})
```

### What it does

* **Fetches** all tasks for a project and groups them by each `worked_dates[]` entry.
* **Renders** each day → many items.
* **Serializes** task content:

    * If `content` is **TipTap JSON** (your normal path), it converts to static HTML (paragraphs, headings, lists, code blocks, blockquotes, hr, images, links, bold/italic/underline/strike/code…).
    * If `content` is a **string** (legacy HTML/plain), it keeps it, but **rewrites any `<img src="/files/:id/...">`** to **data URIs**.
* **Embeds images**: For any local `/files/:id/...` source (or `data-file-id` attr), reads the blob via `getFileById` and `getDiskPathForFile`, base64 encodes, and writes `src="data:<mime>;base64,..."`
* Outputs a **single HTML file** with minimal CSS and no JS (read‑only).

---

## 3) Run it

From the **`server/`** folder:

```bash
# simple (auto-picks first project, auto-derives date range)
npm run export:timeline

# explicit range & output
npm run export:timeline -- --from 2025-09-01 --to 2025-10-11 --out dist/timeline-sep-oct.html

# pick a project id (if you have more than one)
npm run export:timeline -- --project 2 --out dist/project-2.html
```

> Note the extra `--` after the npm script when passing flags.

---

## 4) Notes & extensibility

* **Remote images**: The script only inlines images stored by BelloNote (`/files/:id/...`). External http(s) images remain external; add a fetch+base64 step if you ever want to inline them (usually not needed).
* **Performance**: It reads each referenced file **once** per occurrence. If you want dedup, memoize `fileIdToDataUri` (trivial change).
* **Styling**: The inline CSS is minimal. Customize `baseCss()` to your taste (light theme, print styles, etc.).
* **Filtering**: Right now, a task appears on every day listed in `worked_dates[]`. If you want “aggregate to ancestors” behavior (like your timeline view that pulls parents), inject that logic before `tasksByDate()`.

---

## 5) Why this fits your codebase

* Uses your existing **DB schema** and **files** layer (no extra deps).
* Respects how you store content (TipTap JSON or HTML).
* Generates **100% static & portable HTML** suitable for emailing, archiving, or publishing.