import { Router } from 'express'
import dayjs from 'dayjs'

import { db } from '../lib/db.js'
import { resolveProjectId } from '../util/projectContext.js'
import { parseTagsField } from '../util/tags.js'
import { parseReminderFromTask } from '../util/reminderTokens.js'

const router = Router()

async function loadAllTasks(projectId) {
  return db.all(
    `SELECT id, parent_id, title, status, content, tags, project_id, created_at
       FROM tasks
      WHERE project_id = $1`,
    [projectId]
  )
}

function pathToRoot(task, byId) {
  const path = []
  let cur = task
  const guard = new Set()
  while (cur) {
    if (guard.has(cur.id)) break
    guard.add(cur.id)
    path.push({
      id: cur.id,
      title: cur.title,
      status: cur.status,
      parent_id: cur.parent_id,
      content: cur.content,
      tags: parseTagsField(cur.tags)
    })
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  path.reverse()
  return path
}

router.get('/', async (req, res) => {
  try {
    const projectId = await resolveProjectId(req)

    // Load tasks safely; if anything goes wrong, return an empty timeline gracefully.
    let all = []
    try {
      all = await loadAllTasks(projectId)
    } catch (e) {
      console.warn('[day] loadAllTasks failed, returning empty days', e?.message || e)
      return res.json({ days: [] })
    }

    // Build reminder entries defensively
    let reminderEntries = []
    try {
      reminderEntries = all
        .map((task) => {
          try {
            return { task, reminder: parseReminderFromTask(task) }
          } catch (e) {
            return { task, reminder: null }
          }
        })
        .filter((entry) => {
          try {
            const { reminder } = entry
            if (!reminder || !reminder.remindAt) return false
            if (reminder.status === 'completed' || reminder.status === 'dismissed') return false
            const parsed = dayjs(reminder.remindAt)
            return parsed.isValid()
          } catch (e) {
            return false
          }
        })
    } catch (e) {
      console.warn('[day] reminder parsing failed, continuing with none', e?.message || e)
      reminderEntries = []
    }

    const reminderDates = reminderEntries
      .map((entry) => {
        try { return dayjs(entry.reminder.remindAt).format('YYYY-MM-DD') } catch { return null }
      })
      .filter(Boolean)

    // Collect distinct work log dates safely
    let workLogDates = []
    try {
      const rows = await db.all(
        `SELECT DISTINCT w.date AS date
           FROM work_logs w
           JOIN tasks t ON t.id = w.task_id
          WHERE t.project_id = $1`,
        [projectId]
      )
      workLogDates = rows
        .map((r) => (dayjs(r.date).isValid() ? dayjs(r.date).format('YYYY-MM-DD') : null))
        .filter(Boolean)
    } catch (e) {
      console.warn('[day] work log dates query failed, continuing with none', e?.message || e)
      workLogDates = []
    }

    const dateSet = new Set([...workLogDates, ...reminderDates])
    const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a))

    const byId = new Map(all.map((t) => [t.id, t]))

    // Pre-compute children mapping with safe pushes and stable order
    const children = new Map()
    for (const t of all) {
      const pid = t.parent_id || null
      if (!pid) continue
      if (!children.has(pid)) children.set(pid, [])
      children.get(pid).push(t)
    }
    for (const arr of children.values()) {
      try {
        arr.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      } catch {}
    }

    const days = []
    for (const d of dates) {
      // Fetch tasks that worked on day d; if it fails, treat as empty for that day
      let rows = []
      try {
        rows = await db.all(
          `SELECT t.*
             FROM work_logs w
             JOIN tasks t ON t.id = w.task_id
            WHERE w.date = $1 AND t.project_id = $2
            ORDER BY t.created_at ASC`,
          [d, projectId]
        )
      } catch (e) {
        console.warn('[day] rows for date failed', d, e?.message || e)
        rows = []
      }

      // Reminders due on this date
      let reminders = []
      try {
        reminders = reminderEntries
          .filter((entry) => {
            try { return dayjs(entry.reminder.remindAt).format('YYYY-MM-DD') === d } catch { return false }
          })
          .map((entry) => entry.task)
      } catch {
        reminders = []
      }

      const seedIdSet = new Set(rows.map((r) => r.id))
      const reminderIdSet = new Set(reminders.map((r) => r.id))
      const seedIds = Array.from(seedIdSet)

      const included = new Set()
      const orderedIds = []
      const addTaskAndDescendants = (taskId) => {
        if (included.has(taskId)) return
        included.add(taskId)
        orderedIds.push(taskId)
        const kids = children.get(taskId) || []
        for (const ch of kids) addTaskAndDescendants(ch.id)
      }

      for (const r of rows) addTaskAndDescendants(r.id)
      for (const r of reminders) addTaskAndDescendants(r.id)

      const items = orderedIds.map((id) => {
        const task = byId.get(id)
        return { task_id: id, path: pathToRoot(task, byId) }
      })
      days.push({ date: d, seedIds, reminderIds: Array.from(reminderIdSet), items })
    }

    return res.json({ days })
  } catch (err) {
    console.error('[day] failed to load timeline', err)
    // Never fail hard; return empty days to avoid blocking UI
    return res.json({ days: [] })
  }
})

export default router
