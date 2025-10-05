import { Fragment, Slice } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { ReplaceAroundStep } from 'prosemirror-transform'
import { splitListItem } from 'prosemirror-schema-list'
import { STATUS_EMPTY } from './constants.js'

export function findListItemDepth($pos) {
  if (!$pos) return -1
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    if ($pos.node(depth)?.type?.name === 'listItem') return depth
  }
  return -1
}

export function runListIndentCommand(editor, direction, focusEmptyCallback) {
  if (!editor) return false
  const { state, view } = editor
  if (!view) return false

  if (direction === 'lift') {
    const lifted = editor.chain().focus().liftListItem('listItem').run()
    if (lifted) {
      view.focus()
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => view.focus())
      }
    }
    return lifted
  }

  const listItemType = state.schema.nodes.listItem
  if (!listItemType) return false
  const { $from, $to } = state.selection
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild?.type === listItemType)
  if (!range) return false
  const startIndex = range.startIndex
  if (startIndex === 0) return false
  const parent = range.parent
  const nodeBefore = parent.child(startIndex - 1)
  if (nodeBefore.type !== listItemType) return false

  const nestedBefore = nodeBefore.lastChild && nodeBefore.lastChild.type === parent.type
  const inner = Fragment.from(nestedBefore ? listItemType.create() : null)
  const slice = new Slice(
    Fragment.from(
      listItemType.create(null, Fragment.from(parent.type.create(null, inner)))
    ),
    nestedBefore ? 3 : 1,
    0
  )
  const before = range.start
  const after = range.end
  const originalFrom = state.selection.from
  const tr = state.tr
  tr.step(new ReplaceAroundStep(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true))

  const mapped = tr.mapping.map(originalFrom, 1)
  const nextSelection = TextSelection.near(tr.doc.resolve(mapped))
  tr.setSelection(nextSelection).scrollIntoView()
  view.dispatch(tr)
  // focusEmptyCallback intentionally unused; keeping signature for future adjustments
  view.focus()
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => view.focus())
  }
  return true
}

export function positionOfListChild(parentNode, parentPos, childIndex) {
  if (!parentNode || typeof parentPos !== 'number') return null
  if (childIndex < 0 || childIndex >= parentNode.childCount) return null
  let pos = parentPos + 1
  for (let i = 0; i < parentNode.childCount; i += 1) {
    if (i === childIndex) return pos
    pos += parentNode.child(i).nodeSize
  }
  return null
}

export function runSplitListItemWithSelection(editor, options = {}) {
  if (!editor) return false
  const listItemType = editor.schema.nodes.listItem
  const bulletListType = editor.schema.nodes.bulletList
  if (!listItemType) return false
  if (typeof window !== 'undefined') window.__WL_LAST_SPLIT = { reason: 'start' }
  const { state, view } = editor
  const { selection } = state
  const { $from } = selection
  const listItemDepth = findListItemDepth($from)
  if (listItemDepth === -1) return false
  const listItemPos = $from.before(listItemDepth)
  const listItemNode = $from.node(listItemDepth)
  if (!listItemNode) return false
  const parentDepth = listItemDepth > 0 ? listItemDepth - 1 : null
  const listParent = parentDepth !== null ? $from.node(parentDepth) : null
  const parentPos = parentDepth !== null ? $from.before(parentDepth) : null
  const itemIndex = $from.index(listItemDepth)
  const splitAtStart = !!options.splitAtStart
  let performed = false
  let newCaretPos = null
  const splitSuccess = splitListItem(listItemType)(state, (tr) => {
    performed = true
    const initialSelectionPos = tr.selection.from
    const splitDebugInfo = { nested: 0, remaining: 0, reason: 'unprocessed', index: itemIndex, splitAtStart }

    if (bulletListType) {
      const newItemResolved = tr.doc.resolve(Math.min(tr.doc.content.size, initialSelectionPos))
      let newListItem = null
      let newListItemPos = null
      if (listItemDepth <= newItemResolved.depth) {
        try {
          newListItem = newItemResolved.node(listItemDepth)
          newListItemPos = newItemResolved.before(listItemDepth)
        } catch (error) {
          splitDebugInfo.reason = `resolve-failed:${error?.message || 'unknown'}`
          newListItem = null
          newListItemPos = null
        }
      } else {
        splitDebugInfo.reason = `depth-mismatch:${listItemDepth}->${newItemResolved.depth}`
      }
      if (newListItem) {
        const nestedLists = []
        const remainingChildren = []
        newListItem.content.forEach((child) => {
          if (child.type === bulletListType) nestedLists.push(child)
          else remainingChildren.push(child)
        })
        splitDebugInfo.nested = nestedLists.length
        splitDebugInfo.remaining = remainingChildren.length
        splitDebugInfo.reason = nestedLists.length > 0 ? 'moved' : 'no-nested'

        if (nestedLists.length > 0) {
          const updatedNewItem = newListItem.type.create(newListItem.attrs, Fragment.fromArray(remainingChildren))
          tr.replaceWith(newListItemPos, newListItemPos + newListItem.nodeSize, updatedNewItem)

          const originalItemPos = tr.mapping.map(listItemPos, -1)
          const originalItem = tr.doc.nodeAt(originalItemPos)
          if (originalItem) {
            const originalChildren = []
            originalItem.content.forEach((child) => {
              originalChildren.push(child)
            })
            const updatedOriginal = originalItem.type.create(
              originalItem.attrs,
              Fragment.fromArray([...originalChildren, ...nestedLists])
            )
            tr.replaceWith(originalItemPos, originalItemPos + originalItem.nodeSize, updatedOriginal)
          } else {
            splitDebugInfo.reason = 'missing-original'
          }
        }
        if (newListItemPos !== null) {
          const paragraphNode = newListItem.childCount > 0 ? newListItem.child(0) : null
          const paragraphSize = paragraphNode?.content?.size || 0
          newCaretPos = newListItemPos + 1 + paragraphSize
          if (typeof window !== 'undefined') window.__WL_SPLIT_CARET = { newCaretPos, newListItemPos, paragraphSize }
        }
      } else if (!splitDebugInfo.reason.startsWith('resolve') && !splitDebugInfo.reason.startsWith('depth')) {
        splitDebugInfo.reason = 'no-new-item'
      }
    } else {
      splitDebugInfo.reason = 'no-bullet-type'
    }

    if (typeof window !== 'undefined') window.__WL_LAST_SPLIT = splitDebugInfo

    const targetPos = newCaretPos != null ? newCaretPos : initialSelectionPos
    const mappedSelectionPos = tr.mapping.map(targetPos, 1)
    const resolved = tr.doc.resolve(Math.min(tr.doc.content.size, mappedSelectionPos))
    const nextSelection = TextSelection.create(tr.doc, resolved.pos)
    view.dispatch(tr.setSelection(nextSelection).scrollIntoView())
  })

  if (!splitSuccess || !performed) return false
  view.focus()
  return true
}

export function applySplitStatusAdjustments(editor, meta) {
  if (!editor || !meta) return null
  const { parentPos, originalIndex, newIndex, originalAttrs = {} } = meta
  const { state, view } = editor
  const parentNode = typeof parentPos === 'number' ? state.doc.nodeAt(parentPos) : null
  if (!parentNode) return null

  const tr = state.tr
  let changed = false

  const newItemPos = positionOfListChild(parentNode, parentPos, newIndex)
  if (typeof newItemPos === 'number') {
    const newNode = tr.doc.nodeAt(newItemPos)
    if (newNode) {
      const sanitizedAttrs = {
        ...newNode.attrs,
        status: STATUS_EMPTY,
        dataId: null,
        collapsed: false
      }
      if (
        sanitizedAttrs.status !== newNode.attrs.status ||
        sanitizedAttrs.dataId !== newNode.attrs.dataId ||
        sanitizedAttrs.collapsed !== newNode.attrs.collapsed
      ) {
        tr.setNodeMarkup(newItemPos, newNode.type, sanitizedAttrs, newNode.marks)
        changed = true
      }
    }
  }

  const originalItemPos = positionOfListChild(parentNode, parentPos, originalIndex)
  if (typeof originalItemPos === 'number') {
    const originalNode = tr.doc.nodeAt(originalItemPos)
    if (originalNode) {
      const restoredAttrs = {
        ...originalNode.attrs,
        status: originalAttrs.status ?? STATUS_EMPTY,
        dataId: originalAttrs.dataId ?? null,
        collapsed: originalAttrs.collapsed ?? false
      }
      if (
        restoredAttrs.status !== originalNode.attrs.status ||
        restoredAttrs.dataId !== originalNode.attrs.dataId ||
        restoredAttrs.collapsed !== originalNode.attrs.collapsed
      ) {
        tr.setNodeMarkup(originalItemPos, originalNode.type, restoredAttrs, originalNode.marks)
        changed = true
      }
    }
  }

  if (changed) {
    view.dispatch(tr)
  }

  return { newItemPos, originalItemPos }
}

export function promoteSplitSiblingToChild(editor, context) {
  if (!editor || !context) return false
  const { parentPos, originalIndex, newIndex, listItemType, bulletListType, paragraphType } = context
  const { state, view } = editor
  const parentNode = typeof parentPos === 'number' ? state.doc.nodeAt(parentPos) : null
  if (!parentNode || !listItemType || !bulletListType || !paragraphType) return false
  if (originalIndex < 0 || originalIndex >= parentNode.childCount) return false
  if (newIndex < 0 || newIndex >= parentNode.childCount) return false

  const originalNode = parentNode.child(originalIndex)
  const newSiblingNode = parentNode.child(newIndex)
  if (!originalNode || !newSiblingNode || newSiblingNode.type !== listItemType) return false

  let nestedListNode = null
  originalNode.content.forEach(child => {
    if (!nestedListNode && child.type === bulletListType) nestedListNode = child
  })
  if (!nestedListNode) return false

  const paragraphChild = newSiblingNode.child(0)
  const baseParagraph = paragraphChild && paragraphChild.type === paragraphType ? paragraphChild : paragraphType.create()
  const sanitizedChild = listItemType.create({
    ...newSiblingNode.attrs,
    status: STATUS_EMPTY,
    dataId: null,
    collapsed: false
  }, Fragment.from(baseParagraph))

  const updatedNestedChildren = []
  nestedListNode.content.forEach(child => {
    updatedNestedChildren.push(child)
  })
  updatedNestedChildren.push(sanitizedChild)
  const updatedNestedList = bulletListType.create(nestedListNode.attrs, Fragment.fromArray(updatedNestedChildren))

  const updatedOriginalChildren = []
  originalNode.content.forEach(child => {
    if (child === nestedListNode) updatedOriginalChildren.push(updatedNestedList)
    else updatedOriginalChildren.push(child)
  })
  const updatedOriginalNode = listItemType.create(originalNode.attrs, Fragment.fromArray(updatedOriginalChildren))

  const updatedParentChildren = []
  parentNode.content.forEach((child, index) => {
    if (index === originalIndex) updatedParentChildren.push(updatedOriginalNode)
    else if (index !== newIndex) updatedParentChildren.push(child)
  })
  const updatedParentNode = parentNode.type.create(parentNode.attrs, Fragment.fromArray(updatedParentChildren))

  const tr = view.state.tr
  tr.replaceWith(parentPos, parentPos + parentNode.nodeSize, updatedParentNode)
  view.dispatch(tr)
  return true
}
