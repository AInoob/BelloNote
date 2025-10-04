import { randomUUID } from 'crypto'

import { transaction } from './lib/db.js'

const result = await transaction(async (tx) => {
  await tx.run('DELETE FROM outline_versions')
  await tx.run('DELETE FROM work_logs')
  await tx.run('DELETE FROM tasks')
  await tx.run('DELETE FROM projects')

  const projRow = await tx.get(`INSERT INTO projects (name) VALUES ($1) RETURNING id`, ['Workspace'])
  const projectId = projRow.id

  async function add(title, status = 'todo', parent = null, position = 0) {
    const id = randomUUID()
    await tx.run(
      `INSERT INTO tasks (id, project_id, parent_id, title, status, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, projectId, parent, title, status, position]
    )
    return id
  }

  const a = await add('Task 1', 'in-progress', null, 0)
  const a1 = await add('Sub task 1', 'in-progress', a, 0)
  await tx.run(
    `INSERT INTO work_logs (task_id, date) VALUES ($1, $2)
     ON CONFLICT (task_id, date) DO NOTHING`,
    [a1, '2025-09-20']
  )

  return { projectId }
})

console.log('Seeded workspace.', result)
