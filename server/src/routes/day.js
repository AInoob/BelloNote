import { Router } from 'express'
import dayjs from 'dayjs'

import { db } from '../lib/db.js'
import { resolveProjectId } from '../util/projectContext.js'
import { parseTagsField } from '../util/tags.js'
import { parseReminderFromTask } from '../util/reminderTokens.js'

const router = Router()

async function loadAllTasks(projectId) {
  return db.all(
    `SELECT id, parent_id, title, status, content, tags, project_id, created_at, worked_dates
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
    const all = await loadAllTasks(projectId)

    const reminderEntries = all
      .map((task) => ({ task, reminder: parseReminderFromTask(task) }))
      .filter((entry) => {
        const { reminder } = entry
        if (!reminder || !reminder.remindAt) return false
        if (reminder.status === 'completed' || reminder.status === 'dismissed') return false
        const parsed = dayjs(reminder.remindAt)
        return parsed.isValid()
      })

    const reminderDates = reminderEntries
      .map((entry) => dayjs(entry.reminder.remindAt).format('YYYY-MM-DD'))
      .filter(Boolean)

    const dateToTaskIds = new Map()
    for (const task of all) {
      const dates = Array.isArray(task.worked_dates) ? task.worked_dates : []
      for (const raw of dates) {
        const formatted = dayjs(raw).isValid() ? dayjs(raw).format('YYYY-MM-DD') : null
        if (!formatted) continue
        if (!dateToTaskIds.has(formatted)) dateToTaskIds.set(formatted, new Set())
        dateToTaskIds.get(formatted).add(task.id)
      }
    }
    const workLogDates = Array.from(dateToTaskIds.keys())

    const dateSet = new Set([...workLogDates, ...reminderDates])
    const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a))
    const byId = new Map(all.map((t) => [t.id, t]))
    const children = new Map()
    for (const t of all) {
      const pid = t.parent_id || null
      if (!pid) continue
      if (!children.has(pid)) children.set(pid, [])
      children.get(pid).push(t)
    }
    for (const arr of children.values()) {
      arr.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    }

    const days = []
    for (const d of dates) {
      const taskIdSet = dateToTaskIds.get(d) || new Set()
      const rows = Array.from(taskIdSet)
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))

      const reminders = reminderEntries
        .filter((entry) => dayjs(entry.reminder.remindAt).format('YYYY-MM-DD') === d)
        .map((entry) => entry.task)

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
    return res.status(500).json({ error: 'Internal error' })
  }
})

export default router
