
import { db } from './lib/db.js'
db.exec(`DELETE FROM outline_versions; DELETE FROM work_logs; DELETE FROM tasks; DELETE FROM projects;`)
const proj = db.prepare(`INSERT INTO projects (name) VALUES (?)`).run('Workspace').lastInsertRowid
function add(title, status='todo', parent=null, position=0) {
  return db.prepare(`INSERT INTO tasks (project_id, parent_id, title, status, position) VALUES (?,?,?,?,?)`).run(proj, parent, title, status, position).lastInsertRowid
}
const a = add('Task 1','in-progress',null,0)
const a1 = add('Sub task 1','in-progress',a,0)
db.prepare(`INSERT OR IGNORE INTO work_logs (task_id, date) VALUES (?,?)`).run(a1, '2025-09-20')
console.log('Seeded workspace.')
