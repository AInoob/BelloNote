
import React, { useEffect, useState } from 'react'
import { getDays } from '../api.js'

export default function TimelineView() {
  const [days, setDays] = useState([])
  useEffect(() => { (async () => { const data = await getDays(); setDays(data.days || []) })() }, [])
  if (!days?.length) return <div className="save-indicator">No work logs yet.</div>
  return (
    <div className="timeline">
      {days.map(day => (
        <section key={day.date}>
          <h3>{day.date}</h3>
          {day.items.map((it, i) => (
            <div className="item" key={it.task_id + '_' + i}>
              {it.path.map((p, idx) => (
                <span key={p.id} style={{ marginLeft: idx ? 8 : 0 }}>
                  {idx ? '› ' : ''}{p.title} <span className="status">({p.status})</span>
                </span>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
