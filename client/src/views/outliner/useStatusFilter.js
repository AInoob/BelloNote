// ============================================================================
// Status Filter Hook
// Manages filtering and visibility of outline items based on status, tags, archived, future, soon
// ============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { extractTagsFromText } from './tagUtils.js'

const DEFAULT_TAG_FILTER = { include: [], exclude: [] }

const cssEscape = (value) => {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9\\-_]/g, (match) => `\\\\${match}`)
}

export function useStatusFilter({
  editor,
  statusFilter,
  showArchived,
  showFuture,
  showSoon,
  tagFilters,
  focusRootRef
}) {
  const showFutureRef = useRef(showFuture)
  const showSoonRef = useRef(showSoon)
  const showArchivedRef = useRef(showArchived)
  const statusFilterRef = useRef(statusFilter)
  const tagFiltersRef = useRef(tagFilters)
  const filterScheduleRef = useRef(null)
  const lastFilterRunAtRef = useRef(0)
  const filterRunCounterRef = useRef(0)

  useEffect(() => { showFutureRef.current = showFuture }, [showFuture])
  useEffect(() => { showSoonRef.current = showSoon }, [showSoon])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { tagFiltersRef.current = tagFilters }, [tagFilters])

  const applyStatusFilter = useCallback(() => {
    if (!editor) return
    const root = editor.view.dom
    const hiddenClass = 'filter-hidden'
    const parentClass = 'filter-parent'
    const liNodes = Array.from(root.querySelectorAll('li.li-node'))
    const showFutureCurrent = showFutureRef.current
    const showSoonCurrent = showSoonRef.current
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
      return parts.join(' ').replace(/\\s+/g, ' ').trim()
    }

    liNodes.forEach(li => {
      li.classList.remove(hiddenClass, parentClass, 'focus-root', 'focus-descendant', 'focus-ancestor', 'focus-hidden')
      li.removeAttribute('data-focus-role')
      li.style.display = ''
      const row = li.querySelector(':scope > .li-row')
      if (row) row.style.display = ''

      const body = li.querySelector(':scope > .li-row .li-content')
      const attrBody = li.getAttribute('data-body-text')
      const bodyTextRaw = attrBody && attrBody.trim() ? attrBody : readDirectBodyText(body)
      const bodyText = bodyTextRaw.toLowerCase()
      const tagsFound = extractTagsFromText(bodyTextRaw)
      const canonicalTags = tagsFound.map(t => t.canonical)
      li.dataset.tagsSelf = canonicalTags.join(',')

      const selfArchived = /@archived\\b/.test(bodyText)
      const selfFuture = /@future\\b/.test(bodyText)
      const selfSoon = /@soon\\b/.test(bodyText)

      li.dataset.archivedSelf = selfArchived ? '1' : '0'
      li.dataset.futureSelf = selfFuture ? '1' : '0'
      li.dataset.soonSelf = selfSoon ? '1' : '0'

      const parentLi = li.parentElement?.closest?.('li.li-node') || null
      parentMap.set(li, parentLi)

      const ownTagSet = new Set(canonicalTags)
      const includeSelf = includeRequired ? canonicalTags.some(tag => includeSet.has(tag)) : false
      const excludeSelf = canonicalTags.some(tag => excludeSet.has(tag))
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
    liReverse.forEach(li => {
      const parent = parentMap.get(li)
      if (!parent) return
      const info = infoMap.get(li)
      const parentInfo = infoMap.get(parent)
      if (!info || !parentInfo) return
      if (info.includeSelf || info.includeDescendant) parentInfo.includeDescendant = true
    })

    liNodes.forEach(li => {
      const parent = parentMap.get(li)
      if (!parent) return
      const info = infoMap.get(li)
      const parentInfo = infoMap.get(parent)
      if (!info || !parentInfo) return
      if (parentInfo.includeSelf || parentInfo.includeAncestor) info.includeAncestor = true
      if (parentInfo.excludeSelf || parentInfo.excludeAncestor) info.excludeAncestor = true
    })

    liNodes.forEach(li => {
      const info = infoMap.get(li) || { tags: new Set(), includeSelf: false, includeDescendant: false, includeAncestor: false, excludeSelf: false, excludeAncestor: false }
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
      const hideByStatus = statusFilterCurrent[filterKey] === false
      const hideByArchive = !showArchivedCurrent && archived
      const hideByFuture = !showFutureCurrent && future
      const hideBySoon = !showSoonCurrent && soon
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
        li.classList.add(hiddenClass)
        li.style.display = 'none'
      } else {
        li.classList.remove(hiddenClass)
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
    sorted.forEach(li => {
      if (focusElement) return
      if (!li.classList.contains(hiddenClass)) return
      const descendantVisible = li.querySelector('li.li-node:not(.filter-hidden)')
      if (descendantVisible) {
        li.classList.remove(hiddenClass)
        li.classList.add(parentClass)
      }
    })

  }, [editor, statusFilter, showArchived, showFuture, showSoon])

  const cancelScheduledFilter = useCallback(() => {
    const handle = filterScheduleRef.current
    if (!handle) return
    filterScheduleRef.current = null
    if (handle.type === 'raf') {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(handle.id)
      }
    } else if (handle.type === 'timeout') {
      clearTimeout(handle.id)
    }
  }, [])

  const scheduleApplyStatusFilter = useCallback((reason = 'unknown') => {
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
    const runFilter = () => {
      filterScheduleRef.current = null
      const runId = filterRunCounterRef.current = filterRunCounterRef.current + 1
      const start = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
      try {
        applyStatusFilter()
      } finally {
        const end = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
        lastFilterRunAtRef.current = end
      }
    }

    cancelScheduledFilter()

    const scheduledAt = now
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const rafId = window.requestAnimationFrame(() => {
        runFilter()
      })
      filterScheduleRef.current = { type: 'raf', id: rafId, reason, scheduledAt }
    } else {
      const timeoutId = setTimeout(() => {
        runFilter()
      }, 16)
      filterScheduleRef.current = { type: 'timeout', id: timeoutId, reason, scheduledAt }
    }
  }, [applyStatusFilter, cancelScheduledFilter])

  useEffect(() => () => { cancelScheduledFilter() }, [cancelScheduledFilter])

  return {
    applyStatusFilter,
    scheduleApplyStatusFilter,
    showFutureRef,
    showSoonRef,
    showArchivedRef,
    statusFilterRef,
    tagFiltersRef,
    filterScheduleRef,
    lastFilterRunAtRef
  }
}
