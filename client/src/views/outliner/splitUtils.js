/**
 * Utilities for handling list item splitting and status adjustments
 */

import { Fragment } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { STATUS_EMPTY } from './constants.js'
import { positionOfListChild } from './listCommands.js'

/**
 * Apply status adjustments after splitting a list item
 * 
 * Ensures that when a list item is split:
 * - The new item gets empty status, no dataId, and collapsed=false
 * - The original item retains its original attributes
 * 
 * @param {Object} editor - TipTap editor instance
 * @param {Object} meta - Metadata about the split operation
 * @param {number} meta.parentPos - Position of the parent list
 * @param {number} meta.originalIndex - Index of the original item
 * @param {number} meta.newIndex - Index of the new item
 * @param {Object} meta.originalAttrs - Original attributes to restore
 * @returns {Object|null} Positions of new and original items, or null if failed
 */
export function applySplitStatusAdjustments(editor, meta) {
  if (!editor || !meta) return null
  const { parentPos, originalIndex, newIndex, originalAttrs = {} } = meta
  const { state, view } = editor
  const parentNode = typeof parentPos === 'number' ? state.doc.nodeAt(parentPos) : null
  if (!parentNode) {
    return null
  }

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

/**
 * Promote a split sibling to become a child of the previous item
 * 
 * When a list item is split and the new sibling should become a child
 * of the original item instead of a sibling, this function handles
 * the transformation.
 * 
 * @param {Object} editor - TipTap editor instance
 * @param {Object} context - Context about the split operation
 * @param {number} context.parentPos - Position of the parent list
 * @param {number} context.originalIndex - Index of the original item
 * @param {number} context.newIndex - Index of the new sibling to promote
 * @param {Object} context.listItemType - ProseMirror listItem node type
 * @param {Object} context.bulletListType - ProseMirror bulletList node type
 * @param {Object} context.paragraphType - ProseMirror paragraph node type
 * @returns {boolean} True if promotion succeeded
 */
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
  originalNode.content.forEach(child => { if (!nestedListNode && child.type === bulletListType) nestedListNode = child })
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
  nestedListNode.content.forEach(child => { updatedNestedChildren.push(child) })
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

  let tr = state.tr.replaceWith(parentPos, parentPos + parentNode.nodeSize, updatedParentNode)

  let selectionPos = null
  const reloadedParent = tr.doc.nodeAt(parentPos)
  if (reloadedParent) {
    let runningPos = parentPos + 1
    for (let i = 0; i < reloadedParent.childCount; i += 1) {
      const child = reloadedParent.child(i)
      if (i === originalIndex) {
        let innerPos = runningPos + 1
        for (let j = 0; j < child.childCount; j += 1) {
          const inner = child.child(j)
          if (inner.type === paragraphType) {
            innerPos += inner.nodeSize
          } else if (inner.type === bulletListType) {
            let nestedPos = innerPos
            for (let k = 0; k < inner.childCount; k += 1) {
              const nestedItem = inner.child(k)
              if (k === inner.childCount - 1) {
                const nestedParagraph = nestedItem.child(0)
                if (nestedParagraph && nestedParagraph.type === paragraphType) {
                  const paragraphStart = nestedPos + 1
                  selectionPos = paragraphStart + nestedParagraph.content.size
                }
              }
              nestedPos += nestedItem.nodeSize
            }
            innerPos += inner.nodeSize
          } else {
            innerPos += inner.nodeSize
          }
        }
        break
      }
      runningPos += child.nodeSize
    }
  }

  if (selectionPos !== null) {
    try {
      tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos))
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[split-adjust] selection set failed', error)
    }
  }

  view.dispatch(tr.scrollIntoView())
  return true
}
