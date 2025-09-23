import { Router } from 'express'
import dayjs from 'dayjs'
import { db } from '../lib/db.js'
import { resolveProjectId, assertTaskBelongsToProject } from '../util/projectContext.js'

const router = Router()

function serializeReminder(row) {
  if (!row) return null
  const remindAtIso = row.remind_at ? new Date(row.remind_at).toISOString() : null
  const normalizedStatus = row.status === 'completed' ? 'completed' : 'incomplete'
  const now = dayjs()
  const dismissed = Boolean(row.dismissed_at)
  const due = normalizedStatus === 'incomplete' && !dismissed && remindAtIso
    ? !dayjs(remindAtIso).isAfter(now)
    : false
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    remindAt: remindAtIso,
    status: normalizedStatus,
    message: row.message || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    due
  }
}

function getReminderWithTask(projectId, id) {
  return db.prepare(`
    SELECT r.*, t.title AS task_title, t.status AS task_status
    FROM reminders r
    JOIN tasks t ON t.id = r.task_id
    WHERE r.project_id = ? AND r.id = ?
  `).get(projectId, id)
}

router.get('/', (req, res) => {
  const projectId = resolveProjectId(req)
  const { status, pending } = req.query || {}
  let rows = []
  const base = `
    SELECT r.*, t.title AS task_title, t.status AS task_status
    FROM reminders r
    JOIN tasks t ON t.id = r.task_id
    WHERE r.project_id = ?
  `
  if (pending === '1' || pending === 'true') {
    const nowIso = dayjs().toISOString()
    rows = db.prepare(`${base} AND r.status != 'completed' AND r.dismissed_at IS NULL AND r.remind_at <= ? ORDER BY r.remind_at ASC`).all(projectId, nowIso)
  } else if (status) {
    if (status === 'completed') {
      rows = db.prepare(`${base} AND r.status = 'completed' ORDER BY r.remind_at ASC`).all(projectId)
    } else {
      rows = db.prepare(`${base} AND r.status != 'completed' ORDER BY r.remind_at ASC`).all(projectId)
    }
  } else {
    rows = db.prepare(`${base} ORDER BY r.remind_at ASC`).all(projectId)
  }
  res.json({ reminders: rows.map(serializeReminder) })
})

router.post('/', (req, res) => {
  const projectId = resolveProjectId(req)
  const { taskId, remindAt, message } = req.body || {}
  if (!taskId || !remindAt) {
    return res.status(400).json({ error: 'taskId and remindAt required' })
  }

  const task = assertTaskBelongsToProject(Number(taskId), projectId)
  if (!task) return res.status(404).json({ error: 'task not found' })

  const remindDate = new Date(remindAt)
  if (Number.isNaN(remindDate.valueOf())) {
    return res.status(400).json({ error: 'invalid remindAt' })
  }
  const remindIso = remindDate.toISOString()
  const nowIso = dayjs().toISOString()

  const upsert = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM reminders WHERE project_id = ? AND task_id = ?`).get(projectId, taskId)
    if (existing) {
      db.prepare(`
        UPDATE reminders
        SET remind_at = ?, status = 'incomplete', message = ?, dismissed_at = NULL, completed_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(remindIso, message ?? null, nowIso, existing.id)
      return getReminderWithTask(projectId, existing.id)
    }
    const info = db.prepare(`
      INSERT INTO reminders (project_id, task_id, remind_at, status, message, created_at, updated_at)
      VALUES (?, ?, ?, 'incomplete', ?, ?, ?)
    `).run(projectId, taskId, remindIso, message ?? null, nowIso, nowIso)
    return getReminderWithTask(projectId, info.lastInsertRowid)
  })

  const row = upsert()
  res.status(201).json({ reminder: serializeReminder(row) })
})

router.post('/:id/dismiss', (req, res) => {
  const projectId = resolveProjectId(req)
  const reminderId = Number(req.params.id)
  const nowIso = dayjs().toISOString()
  const row = getReminderWithTask(projectId, reminderId)
  if (!row) return res.status(404).json({ error: 'reminder not found' })

  db.prepare(`
    UPDATE reminders
    SET dismissed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(nowIso, nowIso, reminderId)

  const updated = getReminderWithTask(projectId, reminderId)
  res.json({ reminder: serializeReminder(updated) })
})

router.post('/:id/complete', (req, res) => {
  const projectId = resolveProjectId(req)
  const reminderId = Number(req.params.id)
  const nowIso = dayjs().toISOString()
  const row = getReminderWithTask(projectId, reminderId)
  if (!row) return res.status(404).json({ error: 'reminder not found' })

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE reminders
      SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso, nowIso, reminderId)
    db.prepare(`
      UPDATE tasks
      SET status = 'done', updated_at = ?
      WHERE id = ?
    `).run(nowIso, row.task_id)
  })
  tx()

  const updated = getReminderWithTask(projectId, reminderId)
  res.json({ reminder: serializeReminder(updated) })
})

router.delete('/:id', (req, res) => {
  const projectId = resolveProjectId(req)
  const reminderId = Number(req.params.id)
  const row = getReminderWithTask(projectId, reminderId)
  if (!row) return res.status(404).json({ error: 'reminder not found' })
  db.prepare(`DELETE FROM reminders WHERE id = ?`).run(reminderId)
  res.status(204).end()
})

export default router
