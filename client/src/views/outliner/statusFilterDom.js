import { DEFAULT_TAG_FILTER } from './filterPreferences.js'
import { extractTagsFromText } from './tagUtils.js'

const HIDDEN_CLASS = 'filter-hidden'
const PARENT_CLASS = 'filter-parent'

export function applyStatusFilterDom(root, {
  cssEscape,
  focusId = null,
  showArchived,
  showFuture,
  showSoon,
  statusFilter,
  tagFilters
}) {
  if (!root) return
  const liNodes = Array.from(root.querySelectorAll('li.li-node'))
  const statusConfig = statusFilter || {}
  const tagConfig = tagFilters || DEFAULT_TAG_FILTER
  const includeTags = Array.isArray(tagConfig.include) ? tagConfig.include : []
  const excludeTags = Array.isArray(tagConfig.exclude) ? tagConfig.exclude : []
  const includeSet = new Set(includeTags.map((tag) => String(tag || '').toLowerCase()))
  const excludeSet = new Set(excludeTags.map((tag) => String(tag || '').toLowerCase()))
  const includeRequired = includeSet.size > 0

  const infoMap = new Map()
  const parentMap = new Map()

  let focusElement = null
  if (focusId) {
    try {
      focusElement = root.querySelector(`li.li-node[data-id="${cssEscape ? cssEscape(focusId) : focusId}"]`)
    } catch {
      focusElement = null
    }
  }

  const textNodeType = typeof Node !== 'undefined' ? Node.TEXT_NODE : 3
  const elementNodeType = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1

  const readDirectBodyText = (bodyEl) => {
    if (!bodyEl) return ''
    const ownerLi = bodyEl.closest('li.li-node')
    const parts = []
    const visit = (node) => {
      if (!node) return
      if (node.nodeType === textNodeType) {
        const text = node.textContent
        if (text && text.trim()) parts.push(text)
        return
      }
      if (node.nodeType !== elementNodeType) return
      const el = node
      if (el.matches('ul,ol')) return
      if (ownerLi && el.closest('li.li-node') !== ownerLi) return
      if (el.matches('button, .li-reminder-area, .status-chip, .caret, .drag-toggle')) return
      if (el.hasAttribute('data-node-view-wrapper') || el.hasAttribute('data-node-view-content-react')) {
        el.childNodes.forEach(visit)
        return
      }
      if (el.childNodes && el.childNodes.length) {
        el.childNodes.forEach(visit)
        return
      }
      const text = el.textContent
      if (text && text.trim()) parts.push(text)
    }
    bodyEl.childNodes.forEach(visit)
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }

  liNodes.forEach((li) => {
    li.classList.remove(HIDDEN_CLASS, PARENT_CLASS, 'focus-root', 'focus-descendant', 'focus-ancestor', 'focus-hidden')
    li.removeAttribute('data-focus-role')
    li.style.display = ''
    const row = li.querySelector(':scope > .li-row')
    if (row) row.style.display = ''

    const body = li.querySelector(':scope > .li-row .li-content')
    const attrBody = li.getAttribute('data-body-text')
    const bodyTextRaw = attrBody && attrBody.trim() ? attrBody : readDirectBodyText(body)
    const bodyText = bodyTextRaw.toLowerCase()
    const tagsFound = extractTagsFromText(bodyTextRaw)
    const canonicalTags = tagsFound.map((tag) => tag.canonical)
    li.dataset.tagsSelf = canonicalTags.join(',')

    const selfArchived = /@archived\b/.test(bodyText)
    const selfFuture = /@future\b/.test(bodyText)
    const selfSoon = /@soon\b/.test(bodyText)

    li.dataset.archivedSelf = selfArchived ? '1' : '0'
    li.dataset.futureSelf = selfFuture ? '1' : '0'
    li.dataset.soonSelf = selfSoon ? '1' : '0'

    const parentLi = li.parentElement?.closest?.('li.li-node') || null
    parentMap.set(li, parentLi)

    const ownTagSet = new Set(canonicalTags)
    const includeSelf = includeRequired ? canonicalTags.some((tag) => includeSet.has(tag)) : false
    const excludeSelf = canonicalTags.some((tag) => excludeSet.has(tag))
    infoMap.set(li, {
      tags: ownTagSet,
      includeSelf,
      includeDescendant: false,
      includeAncestor: false,
      excludeSelf,
      excludeAncestor: false
    })
  })

  const liReverse = [...liNodes].reverse()
  liReverse.forEach((li) => {
    const parent = parentMap.get(li)
    if (!parent) return
    const info = infoMap.get(li)
    const parentInfo = infoMap.get(parent)
    if (!info || !parentInfo) return
    if (info.includeSelf || info.includeDescendant) parentInfo.includeDescendant = true
  })

  liNodes.forEach((li) => {
    const parent = parentMap.get(li)
    if (!parent) return
    const info = infoMap.get(li)
    const parentInfo = infoMap.get(parent)
    if (!info || !parentInfo) return
    if (parentInfo.includeSelf || parentInfo.includeAncestor) info.includeAncestor = true
    if (parentInfo.excludeSelf || parentInfo.excludeAncestor) info.excludeAncestor = true
  })

  liNodes.forEach((li) => {
    const info = infoMap.get(li) || {
      tags: new Set(),
      includeSelf: false,
      includeDescendant: false,
      includeAncestor: false,
      excludeSelf: false,
      excludeAncestor: false
    }
    let archived = li.dataset.archivedSelf === '1'
    let future = li.dataset.futureSelf === '1'
    let soon = li.dataset.soonSelf === '1'
    let parent = li.parentElement
    while (!(archived && future && soon) && parent) {
      if (parent.matches && parent.matches('li.li-node')) {
        if (!archived && parent.dataset.archived === '1') archived = true
        if (!future && parent.dataset.future === '1') future = true
        if (!soon && parent.dataset.soon === '1') soon = true
        if (archived && future && soon) break
      }
      parent = parent.parentElement
    }
    li.dataset.archived = archived ? '1' : '0'
    li.dataset.future = future ? '1' : '0'
    li.dataset.soon = soon ? '1' : '0'

    const statusAttr = li.getAttribute('data-status') || ''
    const filterKey = statusAttr === '' ? 'none' : statusAttr
    const hideByStatus = statusConfig[filterKey] === false
    const hideByArchive = !showArchived && archived
    const hideByFuture = !showFuture && future
    const hideBySoon = !showSoon && soon
    const includeVisible = includeRequired ? (info.includeSelf || info.includeDescendant || info.includeAncestor) : true
    const hideByInclude = includeRequired && !includeVisible
    const hideByExclude = info.excludeSelf || info.excludeAncestor
    const hideByTags = hideByInclude || hideByExclude
    li.dataset.tagInclude = includeVisible ? '1' : '0'
    li.dataset.tagExclude = hideByExclude ? '1' : '0'

    const isFocusActive = !!focusElement
    const isRoot = focusElement ? li === focusElement : false
    const isDescendant = focusElement ? (focusElement.contains(li) && li !== focusElement) : false
    const isAncestor = focusElement ? (!isRoot && li.contains(focusElement)) : false

    if (isFocusActive) {
      const role = isRoot ? 'root' : (isAncestor ? 'ancestor' : (isDescendant ? 'descendant' : 'other'))
      li.dataset.focusRole = role
      const row = li.querySelector(':scope > .li-row')
      if (row && role !== 'ancestor') row.style.display = ''
      if (role === 'root') li.classList.add('focus-root')
      if (role === 'ancestor') li.classList.add('focus-ancestor')
      if (role === 'descendant') li.classList.add('focus-descendant')
      if (role === 'other') {
        li.classList.add('focus-hidden')
        li.classList.remove(PARENT_CLASS)
        li.classList.remove(HIDDEN_CLASS)
        li.style.display = 'none'
        return
      }
    } else {
      li.removeAttribute('data-focus-role')
    }

    const shouldHide = (isFocusActive && (isRoot || isDescendant || isAncestor))
      ? false
      : (hideByStatus || hideByArchive || hideByFuture || hideBySoon || hideByTags)

    if (shouldHide) {
      li.classList.add(HIDDEN_CLASS)
      li.style.display = 'none'
    } else {
      li.classList.remove(HIDDEN_CLASS)
      li.style.display = ''
    }
  })

  const depthMap = new Map()
  const getDepth = (el) => {
    if (depthMap.has(el)) return depthMap.get(el)
    let depth = 0
    let current = el.parentElement
    while (current) {
      if (current.matches && current.matches('li.li-node')) depth += 1
      current = current.parentElement
    }
    depthMap.set(el, depth)
    return depth
  }

  const sorted = [...liNodes].sort((a, b) => getDepth(b) - getDepth(a))
  sorted.forEach((li) => {
    if (focusElement) return
    if (!li.classList.contains(HIDDEN_CLASS)) return
    const descendantVisible = li.querySelector('li.li-node:not(.filter-hidden)')
    if (descendantVisible) {
      li.classList.remove(HIDDEN_CLASS)
      li.classList.add(PARENT_CLASS)
    }
  })
}
