import { db } from '../lib/db.js'
import { ensureDefaultProject } from '../lib/projects.js'

function ensureProjectForTests(req) {
  if (req.headers['x-playwright-test'] && process.env.NODE_ENV !== 'production') {
    const row = db.prepare('SELECT id FROM projects WHERE name = ?').get('Playwright E2E')
    if (row?.id) return row.id
    const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run('Playwright E2E')
    return info.lastInsertRowid
  }
  return null
}

function inferTestProjectIdIfPlaywrightDataDir() {
  try {
    const dir = process.env.DATA_DIR || ''
    if (dir.includes('.playwright-data')) {
      const row = db.prepare('SELECT id FROM projects WHERE name = ?').get('Playwright E2E')
      if (row?.id) return row.id
      const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run('Playwright E2E')
      return info.lastInsertRowid
    }
  } catch {}
  return null
}

export function resolveProjectId(req) {
  const testProjectId = ensureProjectForTests(req)
  const inferred = inferTestProjectIdIfPlaywrightDataDir()
  return testProjectId || inferred || ensureDefaultProject()
}

export function assertTaskBelongsToProject(taskId, projectId) {
  if (!taskId) return null
  const row = db.prepare('SELECT id, project_id FROM tasks WHERE id = ?').get(taskId)
  if (!row) return null
  if (row.project_id !== projectId) return null
  return row
}
