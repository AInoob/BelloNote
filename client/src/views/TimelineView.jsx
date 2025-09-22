
import React, { useEffect, useMemo, useState } from 'react'
import { getDays, getOutline, updateTask } from '../api.js'
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

const DATE_RE = /@\d{4}-\d{2}-\d{2}\b/
const hasTag = (node, tag) => {
  const t = (node?.title || '').toLowerCase()
  const bodyLower = JSON.stringify(node?.content || []).toLowerCase()
  const needle = `@${tag}`
  return t.includes(needle) || bodyLower.includes(needle)
}
const hasDate = (node) => {
  const t = node?.title || ''
  const body = JSON.stringify(node?.content || [])
  return DATE_RE.test(t) || DATE_RE.test(body)
}

function collectSoonAndFuture(roots) {
  const soonRoots = []
  const futureRoots = []
  function walk(node, parentSoon=false, parentFuture=false) {
    const selfSoon = hasTag(node, 'soon')
    const selfFuture = hasTag(node, 'future')
    const effSoon = parentSoon || selfSoon
    const effFuture = parentFuture || selfFuture
    const dated = hasDate(node)
    if (effSoon && !dated) { soonRoots.push(node); return }
    if (effFuture && !parentSoon && !dated) { futureRoots.push(node); return }
    for (const ch of (node.children || [])) walk(ch, effSoon, effFuture)
  }
  for (const r of (roots || [])) walk(r, false, false)
  return { soonRoots, futureRoots }
}


export default function TimelineView() {
  const [days, setDays] = useState([])
  const [outlineRoots, setOutlineRoots] = useState([])
  const [showFuture, setShowFuture] = useState(() => { try { const v = localStorage.getItem('worklog.timeline.future'); return v === '0' ? false : true } catch { return true } })
  const [showSoon, setShowSoon] = useState(() => { try { const v = localStorage.getItem('worklog.timeline.soon'); return v === '0' ? false : true } catch { return true } })
  const [showFilters, setShowFilters] = useState(() => { try { const v = localStorage.getItem('worklog.timeline.filters'); return v === '0' ? false : true } catch { return true } })

  useEffect(() => {
    (async () => {
      const data = await getDays(); setDays(data.days || [])
      const o = await getOutline(); setOutlineRoots(o.roots || [])
    })()
  }, [])

  const { soonRoots, futureRoots } = useMemo(() => collectSoonAndFuture(outlineRoots), [outlineRoots])

  if (!days?.length && !soonRoots.length && !futureRoots.length) return <div className="save-indicator">No work logs yet.</div>

  const handleStatusToggle = async (id, nextStatus) => {
    try {
      await updateTask(id, { status: nextStatus })
      const data = await getDays(); setDays(data.days || [])
      const o = await getOutline(); setOutlineRoots(o.roots || [])
    } catch (e) {
      console.error('[timeline] failed to update status', e)
    }
  }
  return (
    <div className="timeline">
      {/* Filter bar for timeline-specific toggles */}
      <div className="status-filter-bar" data-timeline-filter="1" style={{ marginBottom: 8, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div className="filters-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="meta">Filters:</span>
          <button className={`btn pill ${showFilters ? 'active' : ''}`} type="button" onClick={() => { const next = !showFilters; try { localStorage.setItem('worklog.timeline.filters', next ? '1' : '0') } catch {}; setShowFilters(next) }}>
            {showFilters ? 'Shown' : 'Hidden'}
          </button>
        </div>
        {showFilters && (
          <>
            <div className="future-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="meta">Future:</span>
              <button className={`btn pill ${showFuture ? 'active' : ''}`} type="button" onClick={() => { const next = !showFuture; try { localStorage.setItem('worklog.timeline.future', next ? '1' : '0') } catch {}; setShowFuture(next) }}>
                {showFuture ? 'Shown' : 'Hidden'}
              </button>
            </div>
            <div className="soon-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="meta">Soon:</span>
              <button className={`btn pill ${showSoon ? 'active' : ''}`} type="button" onClick={() => { const next = !showSoon; try { localStorage.setItem('worklog.timeline.soon', next ? '1' : '0') } catch {}; setShowSoon(next) }}>
                {showSoon ? 'Shown' : 'Hidden'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Future bucket (should appear before Soon) */}
      {showFuture && futureRoots.length > 0 && (
        <section key="future">
          <h3>Future</h3>
          <div className="history-inline-preview">
            <OutlinerView readOnly={true} forceExpand={true} initialOutline={{ roots: futureRoots }} allowStatusToggleInReadOnly={true} onStatusToggle={handleStatusToggle} />
          </div>
        </section>
      )}

      {/* Soon bucket */}
      {showSoon && soonRoots.length > 0 && (
        <section key="soon">
          <h3>Soon</h3>
          <div className="history-inline-preview">
            <OutlinerView readOnly={true} forceExpand={true} initialOutline={{ roots: soonRoots }} allowStatusToggleInReadOnly={true} onStatusToggle={handleStatusToggle} />
          </div>
        </section>
      )}

      {/* Dated days */}
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
