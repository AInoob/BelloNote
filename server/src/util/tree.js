
import { parseTagsField } from './tags.js'

export function buildProjectTree(tasks, workLogsByTaskId) {
  const byId = new Map()
  const roots = []
  tasks.forEach(t => {
    const tags = parseTagsField(t.tags)
    byId.set(t.id, {
      ...t,
      tags,
      children: [],
      ownWorkedOn: new Set(workLogsByTaskId.get(t.id) || []),
      aggWorkedOn: new Set()
    })
  })
  tasks.forEach(t => {
    const node = byId.get(t.id)
    const parent = t.parent_id ? byId.get(t.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  const visiting = new Set()
  function aggregate(node) {
    if (visiting.has(node.id)) return
    visiting.add(node.id)
    const s = new Set(node.ownWorkedOn)
    for (const c of node.children) {
      aggregate(c)
      for (const d of c.aggWorkedOn) s.add(d)
    }
    node.aggWorkedOn = s
    visiting.delete(node.id)
  }
  roots.forEach(aggregate)
  function finalize(node) {
    node.ownWorkedOnDates = Array.from(node.ownWorkedOn).sort()
    node.workedOnDates = Array.from(node.aggWorkedOn).sort().reverse()
    delete node.ownWorkedOn
    delete node.aggWorkedOn
    node.children.sort((a, b) => {
      const posDiff = (a.position ?? 0) - (b.position ?? 0)
      if (posDiff !== 0) return posDiff
      return String(a.id).localeCompare(String(b.id))
    })
    node.children.forEach(finalize)
  }
  roots.sort((a, b) => {
    const posDiff = (a.position ?? 0) - (b.position ?? 0)
    if (posDiff !== 0) return posDiff
    return String(a.id).localeCompare(String(b.id))
  })
  roots.forEach(finalize)
  return roots
}
