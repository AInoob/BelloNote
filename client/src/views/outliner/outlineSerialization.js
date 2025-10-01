import { STATUS_EMPTY, STARTER_PLACEHOLDER_TITLE, DATE_RE } from './constants.js'
import { REMINDER_TOKEN_REGEX } from '../../utils/reminderTokens.js'

function normalizeBodyNodes(nodes, normalizeImageSrc) {
  return nodes.map((node) => {
    const copy = { ...node }
    if (copy.type === 'image') {
      const src = copy.attrs?.src
      copy.attrs = {
        ...copy.attrs,
        src: normalizeImageSrc ? normalizeImageSrc(src) : src
      }
    }
    if (copy.content) copy.content = normalizeBodyNodes(copy.content, normalizeImageSrc)
    return copy
  })
}

function parseBodyContent(raw, normalizeImageSrc) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? normalizeBodyNodes(parsed, normalizeImageSrc) : []
  } catch {
    return []
  }
}

function defaultBody(titleText, dateTokens, hasExtras) {
  if (!hasExtras && (!dateTokens || !dateTokens.length)) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: titleText || 'Untitled' }] }]
  }
  const textContent = [{ type: 'text', text: titleText || 'Untitled' }]
  if (dateTokens?.length) {
    textContent.push({ type: 'text', text: ' ' + dateTokens.map((d) => `@${d}`).join(' ') })
  }
  return [{ type: 'paragraph', content: textContent }]
}

export function buildOutlineList(nodes, { forceExpand = false, loadCollapsedSetForRoot, normalizeImageSrc } = {}) {
  const collapsedSet = forceExpand ? new Set() : (loadCollapsedSetForRoot ? loadCollapsedSetForRoot(null) : new Set())

  const buildList = (items) => ({
    type: 'bulletList',
    content: items.map((node) => {
      const titleText = node.title || 'Untitled'
      const ownDates = Array.isArray(node.ownWorkedOnDates) ? node.ownWorkedOnDates : []
      const rawBody = node.content ?? node.body ?? []
      const body = parseBodyContent(rawBody, normalizeImageSrc)
      const hasExtras = body.some((bodyNode) => bodyNode.type !== 'paragraph' || (bodyNode.content || []).some((child) => child.type !== 'text'))
      const bodyContent = body.length ? body : defaultBody(titleText, ownDates, hasExtras)
      const children = [...bodyContent]
      if (node.children?.length) children.push(buildList(node.children))

      const idStr = String(node.id)
      const titleLower = (titleText || '').toLowerCase()
      const bodyLower = JSON.stringify(bodyContent || []).toLowerCase()
      const archivedSelf = titleLower.includes('@archived') || bodyLower.includes('@archived')
      const futureSelf = titleLower.includes('@future') || bodyLower.includes('@future')
      const soonSelf = titleLower.includes('@soon') || bodyLower.includes('@soon')
      const tags = Array.isArray(node.tags) ? node.tags.map((tag) => String(tag || '').toLowerCase()) : []

      return {
        type: 'listItem',
        attrs: {
          dataId: node.id,
          status: node.status ?? STATUS_EMPTY,
          collapsed: collapsedSet.has(idStr),
          archivedSelf,
          futureSelf,
          soonSelf,
          tags
        },
        content: children
      }
    })
  })

  if (!nodes || !nodes.length) {
    return {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          attrs: { dataId: null, status: STATUS_EMPTY, collapsed: false },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: STARTER_PLACEHOLDER_TITLE }]
            }
          ]
        }
      ]
    }
  }

  return buildList(nodes)
}

export function extractTitleFromParagraph(paragraphNode) {
  let text = ''
  if (paragraphNode?.content) {
    paragraphNode.content.forEach((node) => {
      if (node.type === 'text') text += node.text
    })
  }
  const cleaned = text
    .replace(REMINDER_TOKEN_REGEX, '')
    .replace(DATE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || 'Untitled'
}

function extractDates(listItemNode) {
  const dates = new Set()
  ;(listItemNode.content || []).forEach((node) => {
    if (node.type === 'paragraph' && node.content) {
      let text = ''
      node.content.forEach((child) => {
        if (child.type === 'text') text += child.text
      })
      ;(text.match(DATE_RE) || []).forEach((match) => dates.add(match.slice(1)))
    }
  })
  return Array.from(dates)
}

export function parseOutlineFromEditor(editor, normalizeImageSrc, pushDebug = () => {}) {
  if (!editor) return []
  const doc = editor.getJSON()
  const results = []

  const walk = (node, collector) => {
    if (!node?.content) return
    const lists = node.type === 'bulletList'
      ? [node]
      : (node.content || []).filter((child) => child.type === 'bulletList')

    for (const list of lists) {
      for (const listItem of list.content || []) {
        if (listItem.type !== 'listItem') continue

        const bodyNodes = []
        let subList = null
        ;(listItem.content || []).forEach((child) => {
          if (child.type === 'bulletList' && !subList) subList = child
          else bodyNodes.push(child)
        })

        const paragraphNode = bodyNodes.find((child) => child.type === 'paragraph')
        const title = extractTitleFromParagraph(paragraphNode)
        const dates = extractDates(listItem)
        const id = listItem.attrs?.dataId || null
        const status = listItem.attrs?.status ?? STATUS_EMPTY
        const item = { id, title, status, dates, ownWorkedOnDates: dates, children: [] }

        if (bodyNodes.length) {
          try {
            const cloned = JSON.parse(JSON.stringify(bodyNodes))
            item.body = normalizeBodyNodes(cloned, normalizeImageSrc)
          } catch {
            item.body = normalizeBodyNodes(bodyNodes, normalizeImageSrc)
          }
          item.content = item.body
          pushDebug('parse: captured body', { id, body: item.body })
        }

        collector.push(item)
        if (subList) walk(subList, item.children)
      }
    }
  }

  walk(doc, results)
  return results
}

const cloneOutline = (outline) => (
  typeof structuredClone === 'function'
    ? structuredClone(outline)
    : JSON.parse(JSON.stringify(outline))
)

function removeNodeById(nodes, id) {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (String(node.id) === String(id)) {
      return { node: nodes.splice(i, 1)[0], index: i }
    }
    if (node.children) {
      const result = removeNodeById(node.children, id)
      if (result?.node) return result
    }
  }
  return { node: null }
}

function insertNodeRelative(nodes, targetId, newNode, after) {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (String(node.id) === String(targetId)) {
      nodes.splice(after ? i + 1 : i, 0, newNode)
      return true
    }
    if (node.children && insertNodeRelative(node.children, targetId, newNode, after)) return true
  }
  return false
}

export function moveNodeInOutline(nodes, dragId, targetId, position = 'before') {
  console.log('[drop] moveNodeInOutline', { dragId, targetId, position })
  if (!dragId || dragId === targetId) return null
  const clone = cloneOutline(nodes)
  const removedInfo = removeNodeById(clone, dragId)
  if (!removedInfo?.node) {
    console.log('[drop] move failed to find dragged node', { dragId })
    return null
  }
  const removed = removedInfo.node
  if (!targetId) {
    clone.push(removed)
    return clone
  }
  if (!insertNodeRelative(clone, targetId, removed, position === 'after')) {
    console.log('[drop] insert fallback to end', { dragId, targetId })
    clone.push(removed)
  }
  return clone
}
