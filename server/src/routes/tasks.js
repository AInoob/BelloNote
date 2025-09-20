
import { Router } from 'express'
import { db } from '../lib/db.js'

const router = Router()

router.get('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const logs = db.prepare(`SELECT date FROM work_logs WHERE task_id = ? ORDER BY date DESC`).all(id)
  res.json({ ...row, workedOnDates: logs.map(l => l.date) })
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const cur = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)
  if (!cur) return res.status(404).json({ error: 'Not found' })
  const title = 'title' in req.body ? req.body.title : cur.title
  const status = 'status' in req.body ? req.body.status : cur.status
  const content = 'content' in req.body ? req.body.content : cur.content
  db.prepare(`UPDATE tasks SET title=?, status=?, content=?, updated_at=datetime('now') WHERE id=?`).run(title, status, content, id)
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)
  res.json(row)
})

export default router
