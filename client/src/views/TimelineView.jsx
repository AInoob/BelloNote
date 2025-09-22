
import React, { useEffect, useMemo, useState } from 'react'
import { getDays, updateTask } from '../api.js'
import OutlinerView from './OutlinerView.jsx'

function buildOutlineFromItems(items, seedIds = [], date = null) {
  // Reconstruct a tree from path arrays so we can render with OutlinerView in read-only mode
  const seedSet = new Set(seedIds)
  const byId = new Map()
  const rootsSet = new Set()
  const ensureNode = (seg) => {
    if (!byId.has(seg.id)) byId.set(seg.id, { id: seg.id, title: seg.title, status: seg.status || 'todo', content: seg.content ?? null, children: [], ownWorkedOnDates: [] })
    return byId.get(seg.id)
  }
  items.forEach(it => {
    const path = Array.isArray(it.path) ? it.path : []
    if (!path.length) return
    rootsSet.add(path[0].id)
    for (let i = 0; i < path.length; i++) {
      const cur = ensureNode(path[i])
      // mark the node if it is a seed (directly logged for the day)
      if (date && seedSet.has(cur.id) && !cur.ownWorkedOnDates.includes(date)) cur.ownWorkedOnDates.push(date)
      const prev = i > 0 ? ensureNode(path[i - 1]) : null
      if (prev) {
        if (!prev.children.find(ch => ch.id === cur.id)) prev.children.push(cur)
      }
    }
  })
  const roots = Array.from(rootsSet).map(id => byId.get(id)).filter(Boolean)
  return roots
}

export default function TimelineView() {
  const [days, setDays] = useState([])
  useEffect(() => { (async () => { const data = await getDays(); setDays(data.days || []) })() }, [])
  if (!days?.length) return <div className="save-indicator">No work logs yet.</div>
  const handleStatusToggle = async (id, nextStatus) => {
    try {
      await updateTask(id, { status: nextStatus })
      const data = await getDays()
      setDays(data.days || [])
    } catch (e) {
      console.error('[timeline] failed to update status', e)
    }
  }
  return (
    <div className="timeline">
      {days.map(day => {
        const roots = buildOutlineFromItems(day.items || [], day.seedIds || [], day.date)
        return (
          <section key={day.date}>
            <h3>{day.date}</h3>
            <div className="history-inline-preview">
              <OutlinerView readOnly={true} forceExpand={true} initialOutline={{ roots }} allowStatusToggleInReadOnly={true} onStatusToggle={handleStatusToggle} />
            </div>
          </section>
        )
      })}
    </div>
  )
}
