import { cssEscape } from '../../utils/cssEscape.js'
import { extractTagsFromText } from './tagUtils.js'

const DEFAULT_TAG_FILTER = { include: [], exclude: [] }
const LAST_VISIBILITY = new WeakMap()

/**
 * Apply status, archive, and tag filters to the editor DOM
 * @param {Object} editor - TipTap editor instance
 * @param {Object} statusFilterRef - Ref to status filter state
 * @param {Object} showArchivedRef - Ref to show archived state
* @param {Object} tagFiltersRef - Ref to tag filters state
 * @param {Object} focusRootRef - Ref to focus root ID
 */
export function applyStatusFilter(
  editor,
  statusFilterRef,
  showArchivedRef,
  tagFiltersRef,
  focusRootRef,
  searchQueryRef
) {
  if (!editor) return
  const root = editor.view.dom
  const hiddenClass = 'filter-hidden'
  const parentClass = 'filter-parent'
  const liNodes = root.querySelectorAll('li.li-node')
  const showArchivedCurrent = showArchivedRef.current
  const statusFilterCurrent = statusFilterRef.current || {}
  const tagFiltersCurrent = tagFiltersRef.current || DEFAULT_TAG_FILTER
  const includeTags = Array.isArray(tagFiltersCurrent.include) ? tagFiltersCurrent.include : []
  const excludeTags = Array.isArray(tagFiltersCurrent.exclude) ? tagFiltersCurrent.exclude : []
  const includeSet = new Set(includeTags.map(tag => String(tag || '').toLowerCase()))
  const excludeSet = new Set(excludeTags.map(tag => String(tag || '').toLowerCase()))
  const includeRequired = includeSet.size > 0
  const infoMap = new Map()
  const parentMap = new Map()
  const focusId = focusRootRef.current
  let focusElement = null
  if (focusId) {
    try {
      focusElement = root.querySelector(`li.li-node[data-id="${cssEscape(focusId)}"]`)
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

  const hasIncludeFilters = includeSet.size > 0
  const hasExcludeFilters = excludeSet.size > 0
  const evaluateTags = hasIncludeFilters || hasExcludeFilters

  for (let i = 0; i < liNodes.length; i++) {
    const li = liNodes[i]
    li.classList.remove(hiddenClass, parentClass, 'focus-root', 'focus-descendant', 'focus-ancestor', 'focus-hidden')
    li.removeAttribute('data-focus-role')
    li.style.display = ''
    const row = li.querySelector(':scope > .li-row')
    if (row) {
      const prevVisibility = LAST_VISIBILITY.get(li)
      if (prevVisibility !== 'visible') {
        row.style.display = ''
        LAST_VISIBILITY.set(li, 'visible')
      }
    }

    const body = li.querySelector(':scope > .li-row .li-content')
    const attrBody = li.getAttribute('data-body-text')
    const bodyTextRaw = attrBody && attrBody.trim() ? attrBody : readDirectBodyText(body)
    const hasAtSymbols = bodyTextRaw.includes('@')
    let bodyTextLower = null
    const getLowerBody = () => {
      if (bodyTextLower !== null) return bodyTextLower
      bodyTextLower = bodyTextRaw.toLowerCase()
      return bodyTextLower
    }

    let canonicalTags = []
    const shouldExtractTags = evaluateTags || bodyTextRaw.includes('#')
    if (shouldExtractTags) {
      const tagsFound = extractTagsFromText(bodyTextRaw)
      canonicalTags = new Array(tagsFound.length)
      for (let j = 0; j < tagsFound.length; j++) canonicalTags[j] = tagsFound[j].canonical
      li.dataset.tagsSelf = canonicalTags.join(',')
    } else {
      li.dataset.tagsSelf = ''
    }

    let selfArchived = false
    if (hasAtSymbols && bodyTextRaw.includes('@archived')) {
      const lower = getLowerBody()
      selfArchived = /@archived\b/.test(lower)
    }

    li.dataset.archivedSelf = selfArchived ? '1' : '0'

    const parentLi = li.parentElement?.closest?.('li.li-node') || null
    parentMap.set(li, parentLi)

    const ownTagSet = new Set(canonicalTags)
    let includeSelf = false
    let excludeSelf = false
    if (evaluateTags) {
      for (let j = 0; j < canonicalTags.length; j++) {
        const tag = canonicalTags[j]
        if (!includeSelf && includeSet.has(tag)) includeSelf = true
        if (!excludeSelf && excludeSet.has(tag)) excludeSelf = true
        if (includeSelf && excludeSelf) break
      }
    }
    infoMap.set(li, {
      tags: ownTagSet,
      includeSelf,
      includeDescendant: false,
      includeAncestor: false,
      excludeSelf,
      excludeAncestor: false
    })
  }

  for (let i = liNodes.length - 1; i >= 0; i--) {
    const li = liNodes[i]
    const parent = parentMap.get(li)
    if (!parent) continue
    const info = infoMap.get(li)
    const parentInfo = infoMap.get(parent)
    if (!info || !parentInfo) continue
    if (info.includeSelf || info.includeDescendant) parentInfo.includeDescendant = true
  }

  for (let i = 0; i < liNodes.length; i++) {
    const li = liNodes[i]
    const parent = parentMap.get(li)
    if (!parent) continue
    const info = infoMap.get(li)
    const parentInfo = infoMap.get(parent)
    if (!info || !parentInfo) continue
    if (parentInfo.includeSelf || parentInfo.includeAncestor) info.includeAncestor = true
    if (parentInfo.excludeSelf || parentInfo.excludeAncestor) info.excludeAncestor = true
  }

  for (let i = 0; i < liNodes.length; i++) {
    const li = liNodes[i]
    const info = infoMap.get(li) || { tags: new Set(), includeSelf: false, includeDescendant: false, includeAncestor: false, excludeSelf: false, excludeAncestor: false }
    let archived = li.dataset.archivedSelf === '1'
    let parent = li.parentElement
    while (!archived && parent) {
      if (parent.matches && parent.matches('li.li-node') && parent.dataset.archived === '1') {
        archived = true
        break
      }
      parent = parent.parentElement
    }
    li.dataset.archived = archived ? '1' : '0'

    const statusAttr = li.getAttribute('data-status') || ''
    const filterKey = statusAttr === '' ? 'none' : statusAttr
    const hideByStatus = statusFilterCurrent[filterKey] === false
    const hideByArchive = !showArchivedCurrent && archived
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
      if (role === 'ancestor') {
        li.classList.add('focus-ancestor')
      }
      if (role === 'descendant') li.classList.add('focus-descendant')
      if (role === 'other') {
        li.classList.add('focus-hidden')
        li.classList.remove(parentClass)
        li.classList.remove(hiddenClass)
        const prevVisibility = LAST_VISIBILITY.get(li)
        if (prevVisibility !== 'hidden') {
          li.style.display = 'none'
          LAST_VISIBILITY.set(li, 'hidden')
        }
        continue
      }
    } else {
      li.removeAttribute('data-focus-role')
    }

    const shouldHide = (isFocusActive && (isRoot || isDescendant || isAncestor))
      ? false
      : (hideByStatus || hideByArchive || hideByTags)
    if (shouldHide) {
      li.classList.add(hiddenClass)
      const prevVisibility = LAST_VISIBILITY.get(li)
      if (prevVisibility !== 'hidden') {
        li.style.display = 'none'
        LAST_VISIBILITY.set(li, 'hidden')
      }
    } else {
      li.classList.remove(hiddenClass)
      const prevVisibility = LAST_VISIBILITY.get(li)
      if (prevVisibility !== 'visible') {
        li.style.display = ''
        LAST_VISIBILITY.set(li, 'visible')
      }
    }
  }

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

  if (!focusElement && liNodes.length) {
    const sorted = Array.from(liNodes).sort((a, b) => getDepth(b) - getDepth(a))
    for (let i = 0; i < sorted.length; i++) {
      const li = sorted[i]
      if (!li.classList.contains(hiddenClass)) continue
      const descendantVisible = li.querySelector('li.li-node:not(.filter-hidden)')
      if (descendantVisible) {
        li.classList.remove(hiddenClass)
        li.classList.add(parentClass)
      }
    }
  }
}
